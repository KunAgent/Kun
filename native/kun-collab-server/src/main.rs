use std::{net::SocketAddr, path::{Path, PathBuf}, sync::Arc};
use axum_server::tls_rustls::RustlsConfig;
use clap::{Parser, Subcommand};
use kun_collab_server::{CiphertextStore, build_router};
use rcgen::generate_simple_self_signed;

#[derive(Parser)]
#[command(name = "kun-collab-server")]
struct Cli {
    #[command(subcommand)] command: Command,
}

#[derive(Subcommand)]
enum Command {
    Init { #[arg(long)] data_dir: PathBuf },
    Serve { #[arg(long)] data_dir: PathBuf, #[arg(long, default_value = "127.0.0.1:19443")] listen: SocketAddr },
    Status { #[arg(long)] data_dir: PathBuf },
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    match cli.command {
        Command::Init { data_dir } => initialize(&data_dir)?,
        Command::Status { data_dir } => {
            let store = CiphertextStore::open(data_dir.join("collaboration.sqlite3"))?;
            println!("serverInstanceId={}", store.server_instance_id());
        }
        Command::Serve { data_dir, listen } => serve(data_dir, listen).await?,
    }
    Ok(())
}

fn initialize(data_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    std::fs::create_dir_all(data_dir)?;
    let certified = generate_simple_self_signed(vec!["localhost".into(), "127.0.0.1".into()])?;
    std::fs::write(data_dir.join("tls-cert.pem"), certified.cert.pem())?;
    std::fs::write(data_dir.join("tls-key.pem"), certified.signing_key.serialize_pem())?;
    let store = CiphertextStore::open(data_dir.join("collaboration.sqlite3"))?;
    println!("serverInstanceId={}", store.server_instance_id());
    if let Some(token) = store.create_operator_enrollment()? {
        println!("operatorEnrollmentToken={token}");
    }
    Ok(())
}

async fn serve(data_dir: PathBuf, listen: SocketAddr) -> Result<(), Box<dyn std::error::Error>> {
    let store = Arc::new(CiphertextStore::open(data_dir.join("collaboration.sqlite3"))?);
    let router = build_router(store);
    let tls = RustlsConfig::from_pem_file(data_dir.join("tls-cert.pem"), data_dir.join("tls-key.pem")).await?;
    axum_server::bind_rustls(listen, tls).serve(router.into_make_service()).await?;
    Ok(())
}
