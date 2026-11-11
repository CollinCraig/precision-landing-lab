fn main() {
    let args: Vec<_> = std::env::args_os().collect();
    if args.len() != 3 || args[1] != "check" {
        eprintln!("usage: plv check RUN_DIR");
        std::process::exit(2);
    }
    match plv::check(std::path::Path::new(&args[2])) {
        Ok(true) => println!("VALID: mission reported success; demo acceptance requires separate review"),
        Ok(false) => {
            eprintln!("VALID FAILURE: mission reported failure; not a demo pass");
            std::process::exit(1);
        }
        Err(e) => {
            let short: String = e.chars().take(240).map(|c| if c.is_control() { ' ' } else { c }).collect();
            eprintln!("INVALID: {short}");
            std::process::exit(3);
        }
    }
}
