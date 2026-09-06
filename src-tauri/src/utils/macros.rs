#[macro_export]
macro_rules! tauri_cmd {
    (
        $(
            $(#[$meta:meta])*
            $vis:vis fn $name:ident(
                $($arg:ident: $ty:ty),* $(,)?
            ) -> anyhow::Result<$ok_ty:ty>
            $body:block
        )*
    ) => {
        $(
            $(#[$meta])*
            #[tauri::command]
            $vis fn $name($($arg: $ty),*) -> Result<$ok_ty, ::tauri::ipc::InvokeError> {
                let result: anyhow::Result<$ok_ty> = (|| $body)();
                result.map_err(|error| {
                    ::log::error!("IPC 命令 {} 执行失败：{:#}", stringify!($name), error);
                    ::tauri::ipc::InvokeError::from(format!("{:#}", error))
                })
            }
        )*
    };
}