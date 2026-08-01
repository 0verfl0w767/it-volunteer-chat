# IT Volunteer Chat

기간: `2026.07.12 ~ 2026.7.27`

장소: `University of Foreign Language Studies (The University of Danang)`

<img width="5712" height="4284" alt="Image" src="https://github.com/user-attachments/assets/bd1db68f-0131-448a-9814-d9e0f4b90641" />

## 주요 기능

2주간 진행한 삼육대학교 ICT 봉사단 활동 중 제작한 프로젝트입니다.

학생들의 실시간 질문 응답, JS Compiler, 과제 제출을 한 번에 운영할 수 있도록 하였습니다.

학생은 이름과 좌석 번호를 입력해 채팅에 참여할 수 있고, 관리자는 `/admin` 페이지에서 질문을 실시간으로 확인하고 답변할 수 있습니다.

과제 제출 파일은 학생별 폴더에 저장되며, 제출 결과는 웹에서 바로 확인할 수 있습니다.

- 학생 실시간 질문 채팅
- 관리자 채팅 실시간 답변
- 관리자 채팅 이미지 붙여넣기 전송 (`Ctrl + V`)
- 채팅 이모지 반응 전송
- 과제 파일 업로드 및 확인
- 업로드된 HTML / CSS / JS / 이미지 웹 미리보기
- `/jscompiler` JavaScript 실행기

## 기술 스택

- Node.js
- Express
- Socket.IO
- HTML / CSS / JavaScript

## 실행 방법

1. 의존성 설치

```bash
npm install
```

2. 환경 변수 파일 생성

`.env`

```env
ADMIN_PASSWORD=change-me
SSL_CERT_PATH=/path/to/fullchain.pem
SSL_KEY_PATH=/path/to/privkey.pem
```

3. 실행

```bash
npm start
```

개발 모드:

```bash
npm run dev
```

## 주요 경로

- `/` : 학생 채팅 페이지
- `/admin` : 관리자 페이지
- `/projects` : 제출 폴더 목록
- `/projects/:folderName` : 특정 제출 폴더
- `/jscompiler` : JavaScript 실행기
- `/health` : 서버 상태 확인

## 환경 변수

- `ADMIN_PASSWORD`
  - 관리자 로그인 비밀번호
- `SSL_CERT_PATH`
  - HTTPS 인증서 경로
- `SSL_KEY_PATH`
  - HTTPS 개인 키 경로
- `PORT` 또는 `HTTPS_PORT`
  - HTTPS 포트
- `HTTP_PORT`
  - HTTP 포트

인증서 경로가 없거나 파일이 존재하지 않으면 HTTP로 실행됩니다.

## 업로드 동작

- 최대 파일 수: `20`
- 개별 파일 최대 크기: `15MB`
- 총 업로드 최대 크기: `50MB`
- 같은 경로의 파일은 재업로드 시 덮어씁니다
- 제출 정보는 `projects/` 아래에 저장됩니다
