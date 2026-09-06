use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename = "meta")]
pub struct MindrizzleFileMeta {
    #[serde(rename = "title")]
    pub title: String,
    #[serde(rename = "description")]
    pub description: String,
    #[serde(rename = "tag")]
    pub tag: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename = "body")]
pub struct MindrizzleFileBody {
    #[serde(rename = "content")]
    pub content: String,
}