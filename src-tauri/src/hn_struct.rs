use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename = "user")]
pub struct HyperNote {
    #[serde(rename = "title")]
    pub title: String,
    #[serde(rename = "description")]
    pub description: String,
    #[serde(rename = "tag")]
    pub tag: Vec<String>,

    #[serde(rename = "content")]
    pub content: String,
}