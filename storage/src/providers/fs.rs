use actix_web::web::Bytes;
use async_trait::async_trait;
use error::{AppResult, Error};
use tokio::{
    fs::{remove_file, File, OpenOptions},
    io::{AsyncReadExt, AsyncWriteExt},
};

use crate::{contract::StorageProvider, streamer::Streamer};

pub struct FsProvider<'provider> {
    data_dir: &'provider str,
}

impl<'provider> FsProvider<'provider> {
    pub fn new(data_dir: &'provider str) -> Self {
        Self { data_dir }
    }

    /// Get full path of a file for the chunk
    pub fn full_path<F: ToString, C: ToString>(&self, filename: F, chunk: C) -> String {
        format!(
            "{}/{}.{}.part",
            self.data_dir,
            filename.to_string(),
            chunk.to_string()
        )
    }

    /// Create the inner streaming method that is then passed into the streamer for
    /// better readeability of the code.
    pub async fn inner_stream(
        &self,
        filename: &str,
        chunk: Option<i32>,
    ) -> impl futures_util::Stream<Item = AppResult<actix_web::web::Bytes>> {
        let files: Vec<File> = match chunk {
            Some(chunk) => match self.get(filename, chunk).await {
                Ok(file) => vec![file],
                Err(e) => {
                    log::error!("Got error when trying to create inner stream: {:#?}", e);
                    vec![]
                }
            },
            None => match self.all(filename).await {
                Ok(files) => files,
                Err(e) => {
                    log::error!("Got error when trying to create inner stream: {:#?}", e);
                    vec![]
                }
            },
        };

        // We are passing the Vec<File> here because those files are not read yet..
        // but in the future if we want to create another FsProvider, for example S3, this would
        // would only have the chunk number and file name passed, or construct of both and then the
        // file getting would be happening inside the closure itself and not before.
        futures_util::stream::unfold(files as Vec<File>, |mut files: Vec<File>| async move {
            let mut file = files.pop()?;

            let mut data = vec![];

            match file.read_to_end(&mut data).await {
                Ok(_) => (),
                Err(e) => return Some((Err(Error::from(e)), files)),
            };

            Some((Ok(Bytes::from(data)), files))
        })
    }
}

#[async_trait]
impl<'ctx> StorageProvider for FsProvider<'ctx> {
    async fn exists(&self, filename: &str, chunk: i32) -> AppResult<bool> {
        Ok(std::path::Path::new(self.full_path(filename, chunk).as_str()).exists())
    }

    async fn get(&self, filename: &str, chunk: i32) -> AppResult<File> {
        OpenOptions::new()
            .read(true)
            .write(true)
            .open(self.full_path(filename, chunk))
            .await
            .map_err(Error::from)
    }

    async fn all(&self, filename: &str) -> AppResult<Vec<File>> {
        let chunks = self.get_uploaded_chunks(filename).await?;
        let mut files: Vec<File> = vec![];

        for chunk in chunks {
            files.push(self.get(filename, chunk).await?);
        }

        Ok(files)
    }

    async fn push(&self, filename: &str, chunk: i32, data: &[u8]) -> AppResult<()> {
        let file = File::create(self.full_path(filename, chunk)).await?;

        let mut writer = tokio::io::BufWriter::new(file);
        writer.write_all(data).await?;
        writer.flush().await?;

        Ok(())
    }

    async fn pull(&self, filename: &str, chunk: i32) -> AppResult<Vec<u8>> {
        let mut file = File::open(self.full_path(filename, chunk)).await?;

        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer).await?;

        Ok(buffer)
    }

    async fn purge(&self, filename: &str) -> AppResult<()> {
        let chunks = self.get_uploaded_chunks(filename).await?;

        for chunk in chunks {
            remove_file(self.full_path(filename, chunk)).await?;
        }

        Ok(())
    }

    async fn get_uploaded_chunks(&self, filename: &str) -> AppResult<Vec<i32>> {
        let pattern = self.full_path(filename, "*");
        let paths = glob::glob(&pattern)?;

        let mut chunks = Vec::new();

        for path in paths {
            let path_str = path?.to_str().unwrap_or_default().replace(".part", "");

            let chunk = path_str
                .split('.')
                .last()
                .unwrap_or_default()
                .parse::<i32>()
                .map_err(|_| {
                    Error::InternalError(
                        "Failed to parse chunk number while getting uploaded chunks".to_string(),
                    )
                })?;

            chunks.push(chunk);
        }

        chunks.sort();

        Ok(chunks)
    }

    async fn stream(&self, filename: &str, chunk: Option<i32>) -> Streamer {
        let stream = self.inner_stream(filename, chunk).await;

        Streamer::new(stream)
    }
}