//! M1 uses filtered pymavlink-compatible tlogs (HEARTBEAT/GLOBAL_POSITION_INT).
use std::{fs::File, io::Read, path::Path};
pub struct Stats {
    pub records: u64,
    pub heartbeat: bool,
    pub position: bool,
}
pub fn crc(bytes: &[u8], extra: u8) -> u16 {
    let mut crc = 0xffffu16;
    for b in bytes.iter().copied().chain(std::iter::once(extra)) {
        let tmp = b ^ crc as u8;
        let tmp = tmp ^ (tmp << 4);
        crc = (crc >> 8) ^ ((tmp as u16) << 8) ^ ((tmp as u16) << 3) ^ ((tmp as u16) >> 4);
    }
    crc
}
pub fn validate(path: &Path, start: u64, end: u64) -> Result<Stats, String> {
    let mut f = File::open(path).map_err(|e| format!("flight.tlog: {e}"))?;
    let mut stats = Stats {
        records: 0,
        heartbeat: false,
        position: false,
    };
    let mut previous = start;
    let mut boot = None;
    let mut vehicle = None;
    loop {
        let mut stamp = [0u8; 8];
        let n = f
            .read(&mut stamp[..1])
            .map_err(|e| format!("flight.tlog: {e}"))?;
        if n == 0 {
            break;
        }
        let read = |f: &mut File, b: &mut [u8]| {
            f.read_exact(b)
                .map_err(|_| "flight.tlog: truncated record".to_string())
        };
        read(&mut f, &mut stamp[1..])?;
        let t = u64::from_be_bytes(stamp);
        if t < previous || t > end {
            return Err(format!(
                "flight.tlog record {}: timestamp out of order or outside run",
                stats.records
            ));
        }
        previous = t;
        let mut prefix = [0u8; 2];
        read(&mut f, &mut prefix)?;
        let header_len = match prefix[0] {
            0xfe => 5,
            0xfd => 9,
            _ => return Err("flight.tlog: expected MAVLink 1/2 magic".into()),
        };
        let mut data = vec![0u8; header_len + prefix[1] as usize];
        data[0] = prefix[1];
        read(&mut f, &mut data[1..header_len])?;
        if prefix[0] == 0xfd && data[1] != 0 {
            return Err(
                "flight.tlog: signed/unknown MAVLink incompatibility flags unsupported in M1"
                    .into(),
            );
        }
        let id = if header_len == 5 {
            data[4] as u32
        } else {
            u32::from_le_bytes([data[6], data[7], data[8], 0])
        };
        let identity = if header_len == 5 {
            (data[2], data[3])
        } else {
            (data[4], data[5])
        };
        if identity != (1, 1) || vehicle.is_some_and(|v| v != identity) {
            return Err("flight.tlog: expected Copter system/component identity 1/1".into());
        }
        vehicle = Some(identity);
        let (length, extra) = match id {
            0 => (9, 50),
            33 => (28, 104),
            _ => {
                return Err(format!(
                    "flight.tlog: message {id} unsupported; writer must filter M1 stream"
                ))
            }
        };
        if prefix[1] as usize > length
            || prefix[1] == 0
            || (header_len == 5 && prefix[1] as usize != length)
        {
            return Err(format!(
                "flight.tlog: invalid payload length for message {id}"
            ));
        }
        read(&mut f, &mut data[header_len..])?;
        let mut checksum = [0u8; 2];
        read(&mut f, &mut checksum)?;
        if u16::from_le_bytes(checksum) != crc(&data, extra) {
            return Err(format!(
                "flight.tlog record {}: MAVLink checksum mismatch",
                stats.records
            ));
        }
        if id == 0 {
            let payload = &data[header_len..];
            if payload.len() < 9 || payload[4] != 2 || payload[5] != 3 || payload[8] != 3 {
                return Err(
                    "flight.tlog: expected ArduPilot quadrotor HEARTBEAT with MAVLink version 3"
                        .into(),
                );
            }
            stats.heartbeat = true;
        }
        if id == 33 {
            let mut payload = [0u8; 28];
            payload[..data.len() - header_len].copy_from_slice(&data[header_len..]);
            let ms = u32::from_le_bytes(payload[..4].try_into().unwrap());
            if boot.is_some_and(|last| ms < last) {
                return Err(
                    "flight.tlog: time_boot_ms decreased (restart/wrap unsupported in M1)".into(),
                );
            }
            boot = Some(ms);
            stats.position = true;
        }
        stats.records += 1;
    }
    Ok(stats)
}
