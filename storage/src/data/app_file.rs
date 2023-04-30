use chrono::NaiveDateTime;
use entity::{files, user_files, Uuid};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AppFile {
    pub id: Uuid,
    pub user_id: Uuid,
    pub is_owner: bool,
    pub encrypted_metadata: String,
    pub name_hash: String,
    pub mime: String,
    pub size: Option<i64>,
    pub chunks: Option<i32>,
    pub chunks_stored: Option<i32>,
    pub file_id: Option<Uuid>,
    pub file_created_at: NaiveDateTime,
    pub created_at: NaiveDateTime,
    pub finished_upload_at: Option<NaiveDateTime>,
    pub is_new: bool,
    pub uploaded_chunks: Option<Vec<i32>>,
}

impl PartialEq for AppFile {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl AppFile {
    pub fn is_file(&self) -> bool {
        !self.is_dir()
    }

    pub fn is_dir(&self) -> bool {
        &self.mime == "dir"
    }

    pub fn get_filename(&self) -> Option<String> {
        if self.is_file() {
            Some(format!(
                "{}-{}",
                &self.created_at.timestamp(),
                &self.id.to_string()
            ))
        } else {
            None
        }
    }

    pub fn is_new(mut self, is_new: bool) -> Self {
        self.is_new = is_new;

        self
    }
}

impl From<(files::Model, user_files::Model)> for AppFile {
    fn from(source: (files::Model, user_files::Model)) -> AppFile {
        let (file, user_file) = source;

        Self {
            id: file.id,
            user_id: user_file.user_id,
            is_owner: user_file.is_owner,
            encrypted_metadata: user_file.encrypted_metadata,
            name_hash: file.name_hash,
            mime: file.mime,
            size: file.size,
            chunks: file.chunks,
            chunks_stored: file.chunks_stored,
            file_id: file.file_id,
            file_created_at: file.file_created_at,
            created_at: file.created_at,
            finished_upload_at: file.finished_upload_at,
            is_new: false,
            uploaded_chunks: None,
        }
    }
}