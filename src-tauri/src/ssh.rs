use std::{
    io::{ErrorKind, Read, Write},
    net::{Shutdown, TcpListener, TcpStream, ToSocketAddrs},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use ssh2::{Channel, CheckResult, KnownHostFileKind, Session};

use crate::db::{Profile, SshAuth};

pub struct SshTunnel {
    pub local_port: u16,
    shutdown: Arc<AtomicBool>,
    _handle: Option<thread::JoinHandle<()>>,
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
    }
}

#[derive(Clone)]
struct SshConfig {
    host: String,
    port: u16,
    username: String,
    auth: SshAuth,
    key_path: String,
    secret: String,
    verify_host: bool,
    target_host: String,
    target_port: u16,
}

impl SshTunnel {
    pub fn start(profile: &Profile, secret: &str) -> Result<SshTunnel, String> {
        let config = SshConfig {
            host: profile.ssh_host.trim().to_string(),
            port: profile.ssh_port,
            username: profile.ssh_username.trim().to_string(),
            auth: profile.ssh_auth,
            key_path: profile.ssh_key_path.trim().to_string(),
            secret: secret.to_string(),
            verify_host: profile.ssh_verify_host,
            target_host: profile.host.trim().to_string(),
            target_port: profile.port,
        };

        if config.host.is_empty() {
            return Err("SSH host is required".to_string());
        }
        if config.username.is_empty() {
            return Err("SSH username is required".to_string());
        }
        if config.target_host.is_empty() {
            return Err("Database host is required".to_string());
        }

        // Fail fast with a clear error before opening the local listener.
        let probe = open_session(&config)?;
        drop(probe);

        let listener = TcpListener::bind(("127.0.0.1", 0))
            .map_err(|e| format!("Could not start local SSH tunnel: {e}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|e| format!("Could not configure SSH tunnel: {e}"))?;
        let local_port = listener
            .local_addr()
            .map_err(|e| format!("Could not read SSH tunnel address: {e}"))?
            .port();

        let shutdown = Arc::new(AtomicBool::new(false));
        let flag = shutdown.clone();
        let cfg = config.clone();
        let handle = thread::Builder::new()
            .name("chilldb-ssh-tunnel".to_string())
            .spawn(move || {
                while !flag.load(Ordering::SeqCst) {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            let cfg = cfg.clone();
                            let _ = thread::Builder::new()
                                .name("chilldb-ssh-forward".to_string())
                                .spawn(move || {
                                    if let Err(error) = forward(stream, &cfg) {
                                        eprintln!("ChillDB SSH tunnel error: {error}");
                                    }
                                });
                        }
                        Err(ref error) if error.kind() == ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(40));
                        }
                        Err(error) => {
                            eprintln!("ChillDB SSH tunnel accept error: {error}");
                            thread::sleep(Duration::from_millis(250));
                        }
                    }
                }
            })
            .map_err(|e| format!("Could not start SSH tunnel thread: {e}"))?;

        Ok(SshTunnel {
            local_port,
            shutdown,
            _handle: Some(handle),
        })
    }
}

fn open_session(config: &SshConfig) -> Result<Session, String> {
    let address = (config.host.as_str(), config.port)
        .to_socket_addrs()
        .map_err(|e| format!("Invalid SSH host '{}': {e}", config.host))?
        .next()
        .ok_or_else(|| format!("Could not resolve SSH host '{}'", config.host))?;

    let tcp = TcpStream::connect_timeout(&address, Duration::from_secs(12))
        .map_err(|e| format!("SSH connection to {}:{} failed: {e}", config.host, config.port))?;
    tcp.set_nodelay(true).ok();

    let mut session = Session::new().map_err(|e| format!("Could not create SSH session: {e}"))?;
    session.set_tcp_stream(tcp);
    session.set_timeout(15_000);
    session
        .handshake()
        .map_err(|e| format!("SSH handshake failed: {e}"))?;

    verify_host_key(&session, config)?;

    match config.auth {
        SshAuth::Password => session
            .userauth_password(&config.username, &config.secret)
            .map_err(|e| format!("SSH password authentication failed: {e}"))?,
        SshAuth::Key => {
            let key_path = resolve_key_path(&config.key_path)?;
            let passphrase = if config.secret.is_empty() {
                None
            } else {
                Some(config.secret.as_str())
            };
            session
                .userauth_pubkey_file(&config.username, None, &key_path, passphrase)
                .map_err(|e| {
                    format!(
                        "SSH key authentication failed using {}: {e}",
                        key_path.display()
                    )
                })?;
        }
    }

    if !session.authenticated() {
        return Err("SSH authentication failed. Check your credentials.".to_string());
    }

    Ok(session)
}

fn verify_host_key(session: &Session, config: &SshConfig) -> Result<(), String> {
    if !config.verify_host {
        return Ok(());
    }

    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    let known_hosts_path = PathBuf::from(home).join(".ssh").join("known_hosts");
    if !known_hosts_path.exists() {
        return Err(format!(
            "SSH host key verification is enabled, but {} was not found. Connect with ssh once, or disable verification.",
            known_hosts_path.display()
        ));
    }

    let mut known_hosts = session
        .known_hosts()
        .map_err(|e| format!("Could not load SSH known hosts: {e}"))?;
    known_hosts
        .read_file(&known_hosts_path, KnownHostFileKind::OpenSSH)
        .map_err(|e| format!("Could not read {}: {e}", known_hosts_path.display()))?;

    let (key, _) = session
        .host_key()
        .ok_or_else(|| "SSH server did not present a host key".to_string())?;

    match known_hosts.check_port(&config.host, config.port, key) {
        CheckResult::Match => Ok(()),
        CheckResult::NotFound => Err(format!(
            "Unknown SSH host key for {}:{}. Add it to ~/.ssh/known_hosts, or disable host key verification.",
            config.host, config.port
        )),
        CheckResult::Mismatch => Err(
            "SSH host key mismatch. This may be a man-in-the-middle attack; connection refused."
                .to_string(),
        ),
        CheckResult::Failure => Err("Could not verify the SSH host key".to_string()),
    }
}

fn resolve_key_path(configured: &str) -> Result<PathBuf, String> {
    if !configured.is_empty() {
        let path = expand_tilde(configured);
        if !path.exists() {
            return Err(format!("SSH private key not found: {}", path.display()));
        }
        return Ok(path);
    }

    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    let ssh_dir = PathBuf::from(home).join(".ssh");
    for candidate in ["id_ed25519", "id_ecdsa", "id_rsa"] {
        let path = ssh_dir.join(candidate);
        if path.exists() {
            return Ok(path);
        }
    }
    Err("No SSH private key configured and no default key found in ~/.ssh".to_string())
}

fn expand_tilde(value: &str) -> PathBuf {
    if value == "~" {
        return std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(value));
    }
    if let Some(rest) = value.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(value)
}

fn forward(stream: TcpStream, config: &SshConfig) -> Result<(), String> {
    let session = open_session(config)?;
    let channel = session
        .channel_direct_tcpip(&config.target_host, config.target_port, None)
        .map_err(|e| {
            format!(
                "SSH tunnel could not reach {}:{}: {e}",
                config.target_host, config.target_port
            )
        })?;
    session.set_blocking(false);
    stream.set_nodelay(true).ok();

    let closed = Arc::new(AtomicBool::new(false));
    let channel = Arc::new(Mutex::new(channel));

    let local_read = stream
        .try_clone()
        .map_err(|e| format!("Could not clone tunnel socket: {e}"))?;
    let local_shutdown = stream
        .try_clone()
        .map_err(|e| format!("Could not clone tunnel socket: {e}"))?;

    let up_channel = channel.clone();
    let up_closed = closed.clone();
    let up = thread::spawn(move || {
        let mut local = local_read;
        let mut buffer = [0u8; 32 * 1024];
        loop {
            if up_closed.load(Ordering::SeqCst) {
                break;
            }
            match local.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    if write_channel(&up_channel, &buffer[..n], &up_closed).is_err() {
                        break;
                    }
                }
                Err(ref error) if error.kind() == ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(1));
                }
                Err(_) => break,
            }
        }
        up_closed.store(true, Ordering::SeqCst);
        let _ = local_shutdown.shutdown(Shutdown::Both);
        if let Ok(mut channel) = up_channel.lock() {
            let _ = channel.send_eof();
        }
    });

    let down_channel = channel.clone();
    let down_closed = closed.clone();
    let down = thread::spawn(move || {
        let mut local = stream;
        let mut buffer = [0u8; 32 * 1024];
        loop {
            if down_closed.load(Ordering::SeqCst) {
                break;
            }
            let read = {
                let mut channel = match down_channel.lock() {
                    Ok(channel) => channel,
                    Err(_) => break,
                };
                match channel.read(&mut buffer) {
                    Ok(0) => 0,
                    Ok(n) => n,
                    Err(ref error) if error.kind() == ErrorKind::WouldBlock => {
                        drop(channel);
                        thread::sleep(Duration::from_millis(1));
                        continue;
                    }
                    Err(_) => 0,
                }
            };
            if read == 0 {
                break;
            }
            if local.write_all(&buffer[..read]).is_err() {
                break;
            }
        }
        down_closed.store(true, Ordering::SeqCst);
        let _ = local.shutdown(Shutdown::Write);
    });

    let _ = up.join();
    closed.store(true, Ordering::SeqCst);
    let _ = down.join();

    if let Ok(mut channel) = channel.lock() {
        let _ = channel.close();
    }
    let _ = session.disconnect(None, "tunnel closed", None);

    Ok(())
}

fn write_channel(
    channel: &Mutex<Channel>,
    mut data: &[u8],
    closed: &AtomicBool,
) -> Result<(), ()> {
    while !data.is_empty() {
        if closed.load(Ordering::SeqCst) {
            return Err(());
        }
        let mut channel = channel.lock().map_err(|_| ())?;
        match channel.write(data) {
            Ok(0) => return Err(()),
            Ok(n) => data = &data[n..],
            Err(ref error) if error.kind() == ErrorKind::WouldBlock => {
                drop(channel);
                thread::sleep(Duration::from_millis(1));
            }
            Err(_) => return Err(()),
        }
    }
    Ok(())
}
