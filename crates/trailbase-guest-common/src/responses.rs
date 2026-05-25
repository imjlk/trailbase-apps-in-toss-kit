use serde::Serialize;
use serde_json::json;
use trailbase_wasm::http::{HeaderValue, IntoBody, Response, StatusCode, header};

#[derive(Debug, Clone)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl ApiError {
    pub fn new(status: StatusCode, code: &'static str, message: impl ToString) -> Self {
        Self {
            status,
            code,
            message: message.to_string(),
        }
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

pub fn ok<T: Serialize>(value: T) -> Response {
    json_response(StatusCode::OK, value)
}

pub fn error(err: ApiError) -> Response {
    json_response(
        err.status,
        json!({
          "error": {
            "code": err.code,
            "message": err.message,
          }
        }),
    )
}

pub fn json_response<T: Serialize>(status: StatusCode, value: T) -> Response {
    let body = match serde_json::to_vec(&value) {
        Ok(bytes) => bytes,
        Err(_) => b"{\"error\":{\"code\":\"SERIALIZATION_FAILED\",\"message\":\"Failed to serialize response\"}}".to_vec(),
    };
    let mut response = Response::new(body.into_body());
    *response.status_mut() = status;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json; charset=utf-8"),
    );
    response
}

pub fn bad_request(code: &'static str, message: impl ToString) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, code, message)
}

pub fn unauthorized(code: &'static str, message: impl ToString) -> ApiError {
    ApiError::new(StatusCode::UNAUTHORIZED, code, message)
}

pub fn forbidden(code: &'static str, message: impl ToString) -> ApiError {
    ApiError::new(StatusCode::FORBIDDEN, code, message)
}

pub fn not_found(code: &'static str, message: impl ToString) -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, code, message)
}

pub fn conflict(code: &'static str, message: impl ToString) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, code, message)
}

pub fn too_many_requests(code: &'static str, message: impl ToString) -> ApiError {
    ApiError::new(StatusCode::TOO_MANY_REQUESTS, code, message)
}

pub fn internal(message: impl ToString) -> ApiError {
    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL", message)
}
