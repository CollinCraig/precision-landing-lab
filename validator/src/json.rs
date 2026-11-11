//! Small strict JSON reader: bounded nesting, duplicate-key rejection, exact integers.
use std::collections::BTreeMap;

#[derive(Debug)]
pub enum Value {
    Null,
    Bool(bool),
    Number(String),
    String(String),
    Array(Vec<Value>),
    Object(BTreeMap<String, Value>),
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_unicode_and_nested_values() {
        let v = parse(br#"{"value":"\uD83D\uDE80","array":[null,true,false,-1.25e+2]}"#).unwrap();
        let Value::Object(o) = v else { panic!("expected object") };
        assert!(matches!(&o["value"], Value::String(s) if s == "🚀"));
        for bad in [r#""\u+041""#, r#""\uDC00""#, r#""\uD800\u0041""#, "[1,]", "[.1]", "[1.]", "[1e]", "[-]", "[01]", "[true false]"] {
            assert!(parse(bad.as_bytes()).is_err(), "accepted {bad}");
        }
        assert!(parse(format!("{}0{}", "[".repeat(34), "]".repeat(34)).as_bytes()).is_err());
    }
}

pub fn parse(bytes: &[u8]) -> Result<Value, String> {
    let s = std::str::from_utf8(bytes).map_err(|_| "JSON must be UTF-8")?;
    let mut p = Parser { s, i: 0 };
    let value = p.value(0)?;
    p.ws();
    if p.i != s.len() { return Err("trailing JSON content".into()); }
    Ok(value)
}

struct Parser<'a> { s: &'a str, i: usize }
impl Parser<'_> {
    fn ws(&mut self) {
        while matches!(self.s.as_bytes().get(self.i), Some(b' ' | b'\n' | b'\r' | b'\t')) { self.i += 1; }
    }
    fn take(&mut self, c: u8) -> bool {
        if self.s.as_bytes().get(self.i) == Some(&c) { self.i += 1; true } else { false }
    }
    fn value(&mut self, depth: usize) -> Result<Value, String> {
        if depth > 32 { return Err("JSON nesting exceeds 32".into()); }
        self.ws();
        match self.s.as_bytes().get(self.i).copied() {
            Some(b'"') => Ok(Value::String(self.string()?)),
            Some(b'{') => {
                self.i += 1;
                let mut fields = BTreeMap::new();
                self.ws();
                if self.take(b'}') { return Ok(Value::Object(fields)); }
                loop {
                    self.ws();
                    let key = self.string()?;
                    self.ws();
                    if !self.take(b':') { return Err("expected ':'".into()); }
                    let value = self.value(depth + 1)?;
                    if fields.insert(key.clone(), value).is_some() { return Err(format!("duplicate key {key}")); }
                    self.ws();
                    if self.take(b'}') { break; }
                    if !self.take(b',') { return Err("expected ',' or '}'".into()); }
                }
                Ok(Value::Object(fields))
            }
            Some(b'[') => {
                self.i += 1;
                let mut values = Vec::new();
                self.ws();
                if self.take(b']') { return Ok(Value::Array(values)); }
                loop {
                    values.push(self.value(depth + 1)?);
                    self.ws();
                    if self.take(b']') { break; }
                    if !self.take(b',') { return Err("expected ',' or ']'".into()); }
                }
                Ok(Value::Array(values))
            }
            Some(b'-' | b'0'..=b'9') => {
                let start = self.i;
                self.take(b'-');
                if !self.take(b'0') { self.digits()?; }
                if self.take(b'.') { self.digits()?; }
                if self.take(b'e') || self.take(b'E') {
                    if !self.take(b'+') { self.take(b'-'); }
                    self.digits()?;
                }
                let n = &self.s[start..self.i];
                if !n.parse::<f64>().map_err(|_| "bad JSON number")?.is_finite() {
                    return Err("numeric fields must be finite".into());
                }
                Ok(Value::Number(n.into()))
            }
            _ => {
                for (literal, value) in [("true", Value::Bool(true)), ("false", Value::Bool(false)), ("null", Value::Null)] {
                    if self.s[self.i..].starts_with(literal) { self.i += literal.len(); return Ok(value); }
                }
                Err("expected JSON value (possibly truncated)".into())
            }
        }
    }
    fn digits(&mut self) -> Result<(), String> {
        let start = self.i;
        while matches!(self.s.as_bytes().get(self.i), Some(b'0'..=b'9')) { self.i += 1; }
        if self.i == start { Err("expected number digits".into()) } else { Ok(()) }
    }
    fn hex(&mut self) -> Result<u32, String> {
        let end = self.i + 4;
        let s = self.s.get(self.i..end).ok_or("truncated Unicode escape")?;
        if !s.bytes().all(|c| c.is_ascii_hexdigit()) { return Err("bad Unicode escape".into()); }
        let n = u32::from_str_radix(s, 16).map_err(|_| "bad Unicode escape")?;
        self.i = end;
        Ok(n)
    }
    fn string(&mut self) -> Result<String, String> {
        if !self.take(b'"') { return Err("expected JSON string".into()); }
        let mut out = String::new();
        loop {
            let c = self.s[self.i..].chars().next().ok_or("truncated JSON string")?;
            self.i += c.len_utf8();
            match c {
                '"' => return Ok(out),
                '\\' => {
                    let e = self.s.as_bytes().get(self.i).copied().ok_or("truncated escape")?;
                    self.i += 1;
                    out.push(match e {
                        b'"' => '"', b'\\' => '\\', b'/' => '/', b'b' => '\u{8}',
                        b'f' => '\u{c}', b'n' => '\n', b'r' => '\r', b't' => '\t',
                        b'u' => {
                            let mut n = self.hex()?;
                            if (0xD800..=0xDBFF).contains(&n) {
                                if !self.take(b'\\') || !self.take(b'u') { return Err("missing low surrogate".into()); }
                                let low = self.hex()?;
                                if !(0xDC00..=0xDFFF).contains(&low) { return Err("bad low surrogate".into()); }
                                n = 0x10000 + ((n - 0xD800) << 10) + low - 0xDC00;
                            }
                            char::from_u32(n).ok_or("invalid Unicode scalar")?
                        }
                        _ => return Err("unknown JSON escape".into()),
                    });
                }
                c if c < '\u{20}' => return Err("unescaped control character".into()),
                _ => out.push(c),
            }
        }
    }
}
