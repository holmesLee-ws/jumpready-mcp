# JumpReady 로컬 MCP 서버

점프레디 REST API를 MCP 도구로 쓰는 로컬 stdio 서버입니다.
점프레디 앱(https://jumpready.vercel.app)에 가입한 뒤 워크스페이스의 「설정 → API·MCP」에서 토큰을 발급하세요.

다음 두 경로 중 하나로 소스를 준비하세요.

1. `git clone https://github.com/holmesLee-ws/jumpready-mcp`를 실행하고 `cd jumpready-mcp`로 이동하세요.
2. 앱의 「설정 → API·MCP」에서 「zip 내려받기」를 눌러 내려받고 압축을 해제한 폴더로 이동하세요.

Node.js 20 이상을 준비하고 이 폴더에서 `npm install --ignore-scripts`를 실행하세요.
클라이언트의 stdio 설정에 `command: node`, `args: ["/절대경로/jumpready-mcp/server.mjs"]`와 env를 지정하세요.

- `JUMPREADY_API_TOKEN`: 앱에서 발급한 토큰. 로그·Git·스크린샷에 남기지 마세요.
- `JUMPREADY_API_URL`: 기본 https://jumpready.vercel.app (테스트는 HTTP loopback 허용).

공식 SDK 2.3.1로 실행합니다. 도구 목록은 인증된 REST `/api/v1/tools`에서 받아 원격 MCP와 같습니다.
쓰기 권한과 업로드 연산이 있을 때만 `upload_document_file_from_path` 도구를 추가합니다.
로컬 파일 경로를 직접 확인한 뒤 호출하세요. 허용 확장자·최대10MiB를 검사하고 서명 URL로 업로드 후 첨부합니다.
기본 업로드 도구는 base64 원문3,000,000바이트까지, 더 큰 파일은 서명 업로드 경로를 사용하세요.

설정 파일은 `chmod 600`으로 본인만 읽게 보관하세요. 유출이 의심되면 앱에서 즉시 폐기하세요.
API URL은 신뢰하는 HTTPS 서버만 지정하세요. API 요청은 리다이렉트를 따라가지 않습니다.
종료는 클라이언트의 MCP 연결 해제 또는 프로세스 종료로 합니다. stdout은 MCP 메시지 전용입니다.
npm에는 게시하지 않습니다.
