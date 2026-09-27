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

// 归档只存标题/描述/标签，故上次编辑时间另取文件修改时间，随元信息一并返回前端
#[derive(Debug, Serialize)]
pub struct MindrizzleFileMetaView {
    #[serde(flatten)]
    pub meta: MindrizzleFileMeta,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}