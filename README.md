# websqlitebrowser

## 문서

- 구현 반영 내역: [doc/implementation-update-20260516.md](doc/implementation-update-20260516.md)

## 진행 메모 (2026-05-17)

- Anthropic Claude 연결 시 `404 not_found` 이슈를 수정했다.
- 원인: OpenAI 호환 엔드포인트(`/chat/completions`)를 강제로 붙이던 로직이 Anthropic `/v1/messages` 주소와 충돌.
- 조치: Anthropic 엔드포인트 감지 후 `/v1/messages` 형식으로 유지하고, 헤더/페이로드/응답 파싱을 Anthropic 규격으로 분기 처리.
- 기본 LLM 설정값을 Anthropic(`https://api.anthropic.com/v1/messages`, `claude-3-5-haiku-20241022`)로 고정하고, 실패 시 Output에 요청 요약/응답 본문이 남도록 디버그 로그를 강화했다.
- 초기 로딩 500 오류(`Path.is_dir(..., follow_symlinks=False)` 인자 미지원)를 수정했다. `pathlib` 호환을 위해 심볼릭 링크는 `is_symlink()`로 제외하고 `is_dir()/is_file()`로 판정하도록 변경했다.
- Anthropic에서 `model not_found`가 발생하면 `/v1/models`를 추가 조회해 현재 API 키로 사용 가능한 모델 목록을 에러 메시지에 함께 출력하도록 개선했다.
- 기본 모델을 `claude-haiku-4-5-20251001`로 변경했다.
- 연결 테스트 성공 시 설정값을 자동 저장하도록 바꿔 Chat이 같은 값을 즉시 사용하게 했고, 마스킹 토큰(`***`)이 실제 토큰을 덮어쓰지 않도록 보호 로직을 추가했다.
- Chat 패널에서 질답이 누적되도록 변경해 스크롤로 이전 대화를 다시 볼 수 있게 했고, 입력창에서 `ArrowUp`/`ArrowDown`으로 이전 질문 히스토리를 탐색하는 기능을 추가했다.
- 일부 환경에서 정적 파일 캐시로 최신 Chat 스크립트가 반영되지 않던 문제를 방지하기 위해 `app.state.js`, `app.chat.js`의 버전 쿼리스트링을 갱신했다.
- `repository`의 숫자 이름 DB 파일(`^\d+\.db$`) 정리를 수행했고, `13.db`는 다른 프로세스 점유로 삭제 실패했다. 남은 DB들을 대상으로 `metadata/databases`, `metadata/tables`, `metadata/skills`에 예시 메타 문서를 생성했다.
- 재시도로 `repository/13.db` 삭제에 성공했고, 연동된 메타 파일(`13.md`, `13-skill01.md`, `13-skill02.md`)도 정리하여 숫자 이름 DB 잔여를 0으로 맞췄다.
- `sample.db`의 실제 스키마(`customers`, `orders`, `sample`)를 기준으로 메타 문서를 구체화했다. 테이블별 메타(`tables/customers.md`, `tables/orders.md`, `tables/sample.md`)와 전역 스킬(`skills/skill01.md`, `skills/skill02.md`), 샘플 스킬(`skills/sample-skill01.md`, `skills/sample-skill02.md`)을 실사용 문맥으로 채웠다.
- Chat 컨텍스트에 메타 문서 로딩을 구현했다. `metadata/databases`, `metadata/tables`, `metadata/skills` 문서를 읽어 `metadata_docs`로 주입하며, 질문에 언급된 테이블명을 우선해 관련 문서를 먼저 전달하도록 확장했다.
- LLM 서버 송수신 내용을 Output에서 확인할 수 있도록 `llm_debug`를 API 응답에 포함하고, Chat/연결테스트에서 `LLM ... OUT/IN` 로그를 출력하도록 반영했다(민감 정보 제외, 긴 내용은 잘라서 표시).
- 파일 미선택 상태에서도 Chat이 현재 탐색 폴더의 SQLite 파일들을 모아 답변할 수 있도록 폴더 컨텍스트 모드를 추가했다. 다중 DB 컨텍스트(`mode=folder`, `databases[]`, 테이블/샘플/메타 문서)를 LLM에 전달하고, 프런트에서 `explorer_path`를 함께 전송하도록 변경했다.
- Chat 응답 카드에 컨텍스트 요약(`context_summary`)을 추가해, 참고한 DB 목록/테이블 수/메타 문서 출처를 화면에서 바로 확인할 수 있게 했다.
- 루트 경로(빈 `currentPath`)에서도 폴더 Chat이 스킵되지 않도록, 파일 미선택 상태의 폴더 컨텍스트 판정을 탐색기 데이터 존재 기준(`lastTreeData`)으로 보완했다.
- Chat 응답 UI를 조정해 `Answer`를 먼저 표시하고, `Context`/`SQL`은 아래의 작은 버튼으로 눌렀을 때만 펼쳐 보이도록 변경했다.
- Chat 내부 처리 과정을 확인할 수 있도록 `trace`를 추가했다. 응답 카드에서 `Trace` 버튼으로 단계(컨텍스트 선택, 메타 로딩, LLM 요청/응답 파싱, SQL 실행 여부)를 펼쳐 볼 수 있고, Output에도 `CHAT TRACE ...` 로그가 함께 남는다.
- 메타 문서 작성 표준화를 위해 프로젝트 최상단에 `guide.txt`를 추가했다. `tables/*.md`, `databases/*.md`, `skills/*.md` 파일명 규칙/템플릿/체크리스트를 정리했다.
- 메타 활용 품질을 높이기 위해 `guide.txt`에 "속성 의미/질문 유형/쿼리 전략" 권장 섹션 스키마를 추가했고, LLM system prompt에서도 해당 섹션을 우선 준수하도록 보강했다.
- 요청에 맞춰 현재 사용 중인 metadata 파일들(`sample/sales/support/warehouse`의 database/table/skill, `customers/orders/sample` 관련 문서)을 간단 형식으로 정리했다.
- Output 패널 위에 수직 조절용 split bar를 추가했다. 마우스로 위/아래 드래그해 높이를 조정할 수 있고, 높이는 localStorage에 저장되어 새로고침 후에도 유지된다. Auto Hide 시에는 22px 헤더만 남도록 동작을 보정했다.
- Chat UI를 정리해 카드형 메시지(You/Answer), Context/SQL/Trace 상세 패널, 메타 선택 이유/발췌 표시 스타일을 개선했다. 기존 기능은 유지하고 가독성만 높였다.
- repository 하위 폴더(`repository/related`)에 `marketing.db` 샘플 DB를 추가했다. 폴더 모드 Chat 컨텍스트가 하위 폴더의 SQLite까지 재귀 수집하도록 확장했고, 폴더 모드에서 LLM이 제안한 SQL은 다중 DB ATTACH 방식으로 실제 실행해 교차 DB 조인 결과를 반환할 수 있게 했다.
- Setting 패널에 SQLite 폴더 설정(`system/current/hist`)을 추가했다. 저장된 3개 폴더를 폴더 모드 Chat 컨텍스트의 우선 소스로 사용하며, 하위 SQLite를 재귀 수집해 LLM 답변/교차 DB SQL 실행에 반영한다. 기본 폴더(`repository/system`, `repository/current`, `repository/hist`)도 생성했다.
- `repository/system`, `repository/current`, `repository/hist`에 샘플 SQLite 파일을 추가했다. 각 폴더별로 2개 DB(`system_status/system_reference`, `current_sales/current_campaign`, `hist_sales_2025/hist_campaign_2025`)를 생성하고 샘플 테이블/데이터를 채웠다.
- Data Explorer에서 긴 파일명이 `...`으로 잘릴 때, 파일명 영역에 마우스 오버하면 전체 이름이 기본 툴팁으로 보이도록 `title`을 추가했다.
- Chat 답변이 모호해서 추가 기준이 필요할 때(예: WARN 시점 기준 불명확), 답변 아래에 객관식 기준 후보 버튼을 자동으로 노출하고 클릭 시 해당 기준으로 즉시 재질문하도록 개선했다.
- Chat 전송/객관식 버튼 클릭 시 브라우저 `PointerEvent`가 질문 문자열로 잘못 전달되던 버그(`[object PointerEvent]`)를 수정했다. 클릭 이벤트는 빈 강제 메시지로 처리하고, 강제 메시지는 문자열일 때만 질문으로 사용한다.
- Chat 입력부를 Copilot 스타일에 가깝게 개선했다. 기본은 `▶` 전송 버튼, 응답 대기 중에는 `■` 중지 버튼으로 전환되며 입력창 상단에 파란 진행 라인이 애니메이션으로 표시된다. 대기 중 `■` 클릭 시 실제 요청 취소(Abort)도 동작한다.
- Chat 전송/중지 버튼 아이콘을 문자 기호에서 SVG 아이콘으로 교체했다. 대기 상태 전환 시 아이콘이 더 선명하게 보이고 접근성 레이블(`aria-label`)도 함께 갱신되도록 했다.
- Chat 대기 상태 파란 진행 표시 위치를 조정했다. 입력창 위 별도 라인이 아니라 질문을 입력하는 에디트(textarea) 자체에서 파란 진행선/테두리 강조가 보이도록 변경했다.
- Chat 대기 상태 테두리 효과를 다시 조정했다. 입력창 테두리 전체가 계속 파랗게 유지되지 않고, 약 1/4 길이의 파란 선분이 테두리를 따라 회전하는 형태로 표시되도록 변경했다.
- Chat 대기 상태 애니메이션을 VS Code 스타일에 가깝게 다시 변경했다. 입력창 외곽 경계선을 따라 파란 선분이 이동하도록 SVG 경로(`stroke-dashoffset`) 기반으로 구현했다.
- Chat의 되묻기 기준 선택 UI를 세로 스택(가로로 긴 버튼 4개)으로 변경하고, 상단에 60초 카운트다운을 표시하도록 개선했다. 시간이 만료되면 맨 위 기준이 자동으로 선택되어 재질문이 실행된다.
- Chat 기준 선택 후에도 다시 기준 선택이 반복 노출되던 루프를 수정했다. 재질문 문구에 `기준 선택:`가 포함된 경우에는 선택지 재생성을 하지 않는다.
- Chat 답변 카드 하단에 액션 아이콘(`좋아요`, `싫어요`, `복사`, `다시`)을 추가했다. 좋아요/싫어요는 토글 상태로 표시되고, 복사는 답변 텍스트를 클립보드로 복사하며, 다시는 동일 질문으로 재요청한다.
- Chat 대기 상태 파란 선의 두께를 더 얇게 조정하고, 회전 속도를 30% 느리게(1.25s → 1.625s) 변경했다.

## 원본 요구사항 메모

여기 web으로 sqlite를 브라우징하는 앱을 만들꺼야. 윈도우나 리눅스에서 실행할꺼고,
그래서 그 경로는 os마다 구분해서 해야해.
웹서버는 django로 하고, 프론트앤드는 js가 놓을꺼 같아.
전체 ui는 sql navigator처럼 왼쪽에 side bar가 있는데,
거긴 data explorer, chat, setting이라는 stack된 버튼? 텝? 그런게 사이드바 아래에 고정되어 있고,
그걸 누르면 그 사이드 바 위로 data explorer, chat, setting 중 선택된 것의 내용이 나와.
data explorer은 실행중인 서버의 디렉토리 및 파일이 나오고, 거기서 sqlite을 선택해서 view를 누르면 사이드바 오른쪽에 그 파일에 있는 테이블들 이름이 각각 텝으로 나오고, 그 결과가 텝 내용에 나와. 그리고 제일 처음 텝엔 Query라는 텝이 있고 그 안엔 가로 split이 있어서 그 위엔 쿼리를 입력하고, 아래엔 그 쿼리 결과가 나오게 해줘.
또, setting엔 말그대로 세팅인데, llm 서버 주소랑 토큰, 모델명등을 입력받고,
chat은 그 정보를 기반으로 이 폴더에 있는 sqlite에 질의 응답을 할 수 있게 할꺼야.

여기 서버에 sqlite 파일들은 다른 시스템에서 i/f하고, 업뎃할꺼고
이 프로그램에서는 그거에 대한 데이터 조회나 질의를 하는걸 제공하려고하는거야.

요구 사항이 너무 많지? 일단 이걸로 기획안을 만들어줘.

어때 이 요구사항으로 만들어 볼 수 있겠어? 이 폴더에 간단한 sqlite 파일도 repository란 폴더를 하나 만들어서 넣고 거기서 시작하게 해줘.

여기 파이썬 가상 환경은 workon v1으로 해줘.



sqlite의 쿼리지만 내가 그 테이블 대상으로 오라클 쿼리를 짜면 그걸로도 실행되서 결과가 나오게 해줘. 예를 들어 select count(*) from abcd where rownum < 11;
이렇게 해도 결과가 나오도록.
그리고 그 결과를 보여주는 그리드에선 cell을 멀티로 선택하고
ctrl + c를 누르면 복사되게 해줘.
또 쿼리 입력창에서 F9를 누르면 실행되게 해주고,


오른쪽 창에 sqlite 파일을 선택하면 그 정보가 나오게 한다고 했잖아.
거기 첫번째 텝이 Query이고, 두번째엔 그 ddl을 볼 수 있게 해줘.
거기 있는 컬럼들 속성들, 그리고 인덱스까지.
그 다음 세번째부터 그 파일에 있는 테이블 정보가 나올 수 있게.


ui를 전체적으로 수정해줘. 어딜 참고하냐면, 여기보다 한칸 위인 pysqltools에 보면
~/workspace/pysqltools/pysqltools_pyside6
의 프로젝트가 있거든. 이건 pyside6으로 sql navigator처럼 만들어서
차일드 윈도우에 그 내가 얘기한 data explorer, chat, setting이 어떤 모양으로
되어있는지 참고 할 수 있어.


아,. 그래도 이상한데, data explorer, chat, setting가 세로로 쌓여있어야 하는데,
지금은 그냥 투박한 버튼으로 아무렇게나 붙어있어.


1. Chat 프롬프트를 더 엄격한 JSON 형식으로 고정하기, 2. 결과 그리드의 드래그 범위 선택 추가, 3. 대용량 테이블 페이지네이션



그래도 이상해. 아까 알려준 pysqltools에 있는 그 컨트롤 이름이 뭔지 알려줘.


그래 이 acitvity side bar에 data explorer, chat, setting가 있고,
이걸 선택하면 이 위에 그 내용이 있어야 하는데, 같은 틀 안에서.
그런데 지금은 그 내용이 오른쪽에 따로 있잖아.
그래서 이상해 보여. 그리고 글자도 너무 커서 컴팩트하게 안 보여. 전체적으로 수정해줘.


pysqltool를 윈도우 화면에서 실행하면 글자, 메뉴가 어느 크기로 보이는지 알지?
이 웹 화면도 그렇게 보이도록 전체적으로 크기를 조정해줘.
pysqltool에서는 그 acitvity side bar에 data explorer, chat, setting들이 아래에 고정되어있잖아? 그런데 얘는 뭘 누를때마다 이동하거든. 크기에 따라 그런거 같은데, 이 부분도 수정해줘.


한 화면에 나오게 해줘. 지금은 아래로 스크롤해서 봐야해. 위 미세조정이랑 같이 진행해줘.


repo에 sqlite 파일을 몇개 더 추가해줘. 그리고 화면에 별 의미 없는건 없애줘.
예를 들어 acitvity sidebar 라는 버튼? 라벨? 이런거.



선택된 SQLite 파일이 없습니다
왼쪽에서 repository 폴더 아래 SQLite 파일을 열어주세요.
repository •no database opened

이런것도 굳이 세로 영역을 많이 차지하고 있을 필요는 없을것 같거든.


SQLite Browser
Windows / Linux 경로를 분리해 처리하고, 서버 로컬 repository 아래의 SQLite 파일만 탐색합니다.
위 글자도 없애줘.


또 이 화면의 전체적인 스타일이 누런색인데, 이러지말고, pysqltools를 실행하는것처럼
윈도우 프로그램 느낌으로 색이나 버튼 색등을 바꿔줘.


acitvity side bar에 대표 메뉴명이 있고, 그 아래 Browse repository등 설명이 있는데, 이런 설명들을 없애줘.


선택된 SQLite 파일이 없습니다
|
왼쪽에서 SQLite 파일을 열어주세요.
이런 멘트도 없애줘.


채팅창에서 채팅 입력창은 아래에 있어야지. 질의 보내기 라는 큰 버튼 대신 오른쪽 옆에 작은 네모 버튼을 하나 추가해서 그걸로 되게 해줘. 거기서 ctrl + enter를 치면 보내기 되게 해주고.


여기 data explorer 데이터가 나오는 제일 아래에 우리 윈도우 프로그램에 있는 statusbar같은걸 추가해서 현재 디렉토리의 정보를 추가해줘.
여기 폴더, 파일은 몇개이고, 용량은 얼마고 몇프로 사용중인지.


chat에서 "메시지를 입력하고 Ctrl+Enter 또는 전송 버튼을 눌러주세요."라는 메세지도 없애줘. 그리고 채팅 입력창이 반쯤 가려서 시작되는데 아마 여기 activity side bar라서 그런가? 이 크기를 점검해줘.


activity side bar가 이상한데, 이게 동작하는게 tab ctrl처럼
tab을 눌렀을때 그 내용들이 위에 나와야하는데, 지금은 그냥 
data explorer, chat, setting들이 한 페이지에 있고 그게 쭉 나오는거 같아.
수정해줘.


data explorer엔 여러 파일이 보일꺼라 최대한 윈도우 파일 익스플로러나,
파일 zilla client 처럼 보이게 해줘. 지금은 파일 하나에 버튼 하나를 할당한것 같거든. 그리고 그 파일명 오른쪽으론 사이즈랑 마지막 변경 시간을 YYYYMMDD HH24MISS 포멧으로 나오게 해줘.


data explorer의 전체적인 ui를 file zilla client 처럼 해줘.
지금은 상위 폴더로 안 올라가지는데, 각 폴더마다 ../가 젤 위에 있어서
그걸 누르면 이동하게 해줘.


data explorer에서 파일명이 길면 .. 으로 뒤를 해주고, 지금 너무 세로로 많은 공간을 쓰고 있거든. 한줄로 얇게 해줘.


아직도 너무 두꺼운데? 나는 지금 파일 4개밖에 안 보이는데, 한 20개는 되게끔 수정해줘.


여기 예제 파일을 한 100개 만들어줘봐. sqlite 파일을 그냥 번호 1, 2, 3 붙여서 해줘.


여기 파일명 앞에 붙은 [DB]는 뭐야? 이런 쓸데 없는건 다 빼줘.

여기에 적절하게 폴더도 하나 몇단계로 만들어줘. 올라가고 들어가고 하는게 되나 보게.


위에 폴더 들어가봤는데, 거긴 파일이 몇개 없더라고.
그러니까 한 파일을 나타내는 item이 엄청 커져, 글자도 커지고.
어디든 지금 처음 크기처럼 나오게 해줘. 그리고 각 폴더마다 제일 위엔 ../ 있어서 상위로 올라가게 해주고.


지금 첫 화면엔 ../가 안나오는데? 이 상위 폴더도 올라갈 수 있게 해줘.


sqlite 파일을 선택했을때, 오른쪽에 나오는 화면도 전체적으로 수정해줘.
글자가 너무 크고, 가로로 split도 조정이 안되고, 전체 화면을 다 쓰지 않고 있어.


그리고 전체적으로 뭔 설명같은건 다 빼줘. 지금 이 화면에서 볼것도 많은데,
그런 고정적인 정보를 계속 보여주느라 공간을 차지하고 있을 필요는 없잖아.


이건 정말 이상한데? 브라우저의 크기를 조정하면 같이 맞춰서 조정되어야 하는데,
지금은 그렇지 않아.


오른쪽 창에서 select * from sample 입력하고 실행해도 결과가 아래 그리드에 안나오는데?


오른쪽 화면 아래에 비주얼 스튜디오 6.0에서 output 창 처럼
그런 영역을 할당해서 내부 쿼리 결과, 뭐 디렉토리 이동하는 거나
그런걸 logging해서 나오게 해줘.

output은 비주얼 스튜디오에서도 제일 아래에 있잖아.
그런데 지금은 위에 있네? 아래로 옮겨줘.


지금 리팩토링해야되는건 아닌지 점검해줘. 한 파일에 로직이 몰리거나하진 않는지.
그렇다면 적절하게 css나 js로 분리할 계획을 세워서 보여줘.


이 프로그램 전체적인 스타일이 하늘색인데 그러지 말고, 윈도우 프로그램 사용하는것처럼 회색인가? 그걸로 해주고, 각 윈도우의 타이틀바? 그런걸 파란색으로 해줘? 뭔 스타일인지 알지? 윈도우 xp에서 클래식 스타일로


data explorer 를 선택했을때 오른쪽 화면이 전체적으로 너무 투박해.
그 이유를 보면, 텝이 쓸데없이 너무 커. 버튼도 그렇거든.
그리고 split window처럼 보이는것도 마우스를 갖다 대면 이동할 수 있게 하이라이팅됐다가 누르면 움직여야하는데 그렇지 않잖아.
쭉 점검하고 수정해줘.


Chat의 대화 내용이 있는데는 밝게 해줘.


data explorer 를 선택했을때 오른쪽 화면에 sql 사이에 있는 공간은 뭐야?
나오는게 없는데 없애줘.


아까 지운 sql이랑 실행 결과 사이에 있는 split을 복원해줘. 그래야 sql이 길면 내려서 보지


여기 실행 이라는 버튼? 라벨? 그것도 없애줘.


sql을 타이핑 쳤을때, 하이라이팅도 해줘. 기본적인 키워드는 파란색으로


여기 Query, DDL, 그 옆에 sample이 아니라 테이블 이름 마다 tab에 그 테이블 이름을 주고, 그안 모든 데이터를 쿼리해서 나오게 해줘.


여기 테이블 데이터가 크더라도 스무쓰하게 다 나오게 해줘. 예를 들어 1만 row라도.그런 기법이 있잖아.


sql 타이핑 치는 폰트를 fixed sys로 해줘. 크기는 12로 해주고,
output에 나오는건 커리어 뉴로 해주고. 대충 size는 10으로 해줘.


여기 output 창에 auto hide 기능을 넣을 수 있을까? 위 오른쪽 끝에.
그걸 toggle해서 보고 안보고 할 수 있게해줘.


sql 타이핑 치는 폰트가 fixedsys가 아닌거 같은데?


sql에서 여러 sql을 실행해도 나오게 해줘.
예를 들어 다음처럼 하면 두개를 파싱해서 실행하고 그 결과를
result1, result2 이렇게 텝으로 나오게 해줘.

SELECT name FROM sqlite_master WHERE type = 'table';
SELECT name FROM sqlite_master WHERE type = 'table2';


그리고 쿼리 실행할때 언제 실행했다, 몇 row fetch 됐다,
뭐 이런 정보 나오게 해줘.


또 output 창에 젤 앞에 시간이 YYYYMMDD HH24MISS 이렇게 나오게 해줘.


이 프로그램을 윈도우로 가져가서 해보니까 좀 이상해. data explorer에서 현재 폴더를 넘어서 그 위로 이동하지 못해.


여기 requirements.txt를 추가해줘.


그리고 data explorer에 글자를 두껍지 않게 해줘.


또 윈도우에서 실행해보니까 sql 입력하는 창을 아래 split을 내려서 늘렸는데도
처음 사이즈 아래로 커서가 내려가질 않는거 같아.

윈도우라 그런지, 지금보다 글자를 1.2배 크게 해줘. 그래야 눈에 잘 들어온다.


또 옆에 activity side bar? 그거를 좌, 우로 이동해서 조정할 수 있게 해줘.


또 위에 리로드 옆에 쿼리? 그 버튼은 뭐야? 필요 없는거 같은데 없애줘.


아니 내가 크게 해달라는건 버튼의 크기가 아니라, sql의 에디트창이나 output이야.
원래 버튼들은 예전 크기로 해줘.


폰으로 보니까 글자 크기가 다르다.
os로 구분해서 폰이면 예전 글자 크기로 하고, 윈도우면 현재 크기로 좀 더 크게 해줘.


data explorer 선택하고 그 테이블 결과를 보는 오른쪽을 보니까 다시 엉망진창인데?
텍스트가 split된 영역안을 다 채우지 못하고 작게 그냥 있어.
이런거 다 점검해줘.


ddl tab을 선택했을때 나오는 아래 내용이 그 아래로 내려갈 수 없어.
스크롤 바를 추가해줘.


지금 리팩토링해야되는건 아닌지 점검해줘. 한 파일에 로직이 몰리거나하진 않는지.
그렇다면 적절하게 css나 js로 분리할 계획을 세워서 보여줘.


거기서 다음은 없애줘.
컬럼 정의와 인덱스, 원본 CREATE SQL을 확인할 수 있습니다.
란 문자열이랑

CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL, joined_at TEXT NOT NULL)
아래 정의가 있으니까 위처럼 ddl은 없어도 될듯해


또 데이터 익스플로러 위에 필터 에디트 하나 추가해서 거기에 
뭔가 입력하면 그 문자열을 포함한것만 아래에 하이라이팅되서 나오게 해줘.


또 데이터 익스플로러 위에 하얀 줄이 하나 있는데, 거기에 현재 위치가 
나오게 해줘. 사이드바 오른쪽에 위치랑 리로드랑 이렇게 있는데,
그걸 여기로.


바탕색이 이상한지, 리로드 옆에 경로가 안 보인느데? 그러다 선택하면 글자가 보이고.


data explorer에서 파일을 선택하고, 키보드로 위 아래를 누르면
그 위파일, 아래 파일이 선택되게 해줘. 지금은 그냥 페이지만 위아래로 움직여.

키보드에서 페이지 버튼 업,다운을 눌렀을때도, 아이템을 선택하면 이동하게 해줘.
지금은 그냥 페이지만 위아래로 되.


home, end도 젤 처음, 젤 아래로 되게 해줘.


여기 아이템에 항상 ../이 있으니까 상위 폴더 버튼은 없어도 될꺼 같아.


sql edit 창에서 뭔가 선택하고 ctrl + c 하면 그 문자열이 복사되고,
그리드에서 cell을 선택해서 ctrl + c 하면 그 cell 내용들이 복사되게 해줘.
지금은 그냥 cell만 복사되게 되어있는것 같아. 일단 확인 먼저 해줘.


sql 결과 그리드에 문제가 많네. 이거 sql navigator나 sql develper처럼
cell들을 멀티로 선택하고 키보드로 이동하는거랑 마우스 휠로 이동하는등,
그런 기본적인 기능들이 꽤 많이 있잖아. 그런게 하나도 없는거 같아.
네가 봐서 추가해야될 기능들을 일단 리스트업 해줘.

sql 결과 그리드에 결과 문자열이 길다고해서 그 줄을 길게 하지 말아줘. 너무 길면 그냥 그 뒤를 ...로 해서 보여줘. 그리고 그리드를 지금처럼 컬럼을 하늘색으로 하는게 아니라 sql developer처럼 윈도우 그리드처럼
회색으로 해줘. 회색이 검은 글자로.


아직도 긴건 텍스트가 다 나와서, 두꺼운 줄로 보이는데?
그리고 그리드의 헤더 색은 회색으로 해주고, 그 헤더의 넓이는 마우스로 선택해서 조절할 수 있게 해줘. 이런건 기본적인 기능인데, 다른 비슷한 윈도우 프로그램의 
그리드나 리스트 컨트롤에 있는 기능중 여기 없는것을 리스트업해줘.


나랑 몇시간동안 이 프로그램을 만들었는데, 이걸 너한테 이 파일봐 한다음에
이만큼 만들게 하려면, 여러번 프로프팅을 해야하잖아. 그 내용을 여기 design.txt 파일을 만들어서 넣어줘.


chat을 눌렀을때 저 위에 대화내용 시작하는 그 위치도 더 위에 하얀 줄? 에디트박스? 그건 뭐야? 필요 없는거면 지워줘.


컬럼이 A, B, C 이렇게 있는데, 내가 A와 B 사이를 선택하고
A 쪽으로 옮기면 A도 B쪽으로 이동해. 왜 그런거지? 그냥 왼쪽은 가만히 있게해줘.
이런 기본적인 구현이 복합한거야?

그리드내 셀과 셀 사이도 얇은 점선?을 넣어서 구분하게 해줘

그리고 셀의 처음 넓이는 그 헤더의 텍스트 길이를 기준으로 해줘. 지금은 너무 길게 되어있어. 초기 사이즈가.

제일 왼쪽에 rownum의 넓이도 꽤 줄여줘.


output창에 있는 text의 size를 12로 크게 해줘.


output 윈도우에 있는 오른쪽 위에 autohide랑 clear랑 글자를 얇고 작게 해줘.
앞에 있는 output보다 크네. 아니면 그걸 의미하는 적절한 아이콘으로 해주던지.


이 프로그램 소스를 보고, 이 프로그램 개발자의 수준을 평가해줘. 한국어로 설명해줘.


여기 llm 설정을 젤 밖에 config.yml에 설정해서 쓸 수 있게 해줘.

data explorer에서 최상위 디렉토리까지 올라가게 해줘.
여긴 폰이라 몇칸 위까지 밖에 못가지만 다른데선 올라가야하거든.
만약에 권한때문에 안되거나하면 그걸 output에 나와서 알게 해줘.
directory_stats() 함수에서 현재 디렉토리의 모든 하위 디렉토리를 다 스캔하고 있는거 같은데, 이거 수정해줘.


윈도우에서 보니까 data explorer에서 폴더 파일 리스트의 크기가 작던데,
1.5배 크게 해줘. 폰에서는 그대로 해주고.


내가 **“로컬 repository 아래 SQLite 파일들을 안전하게 브라우징하고, SQL/스키마 조회 및 LLM 질의까지 한 화면에서 처리하는 웹 SQL Navigator”**를 구현한 프로젝트를 만들었는데, 여기 chat 기능이 있어. setting에 llm 서버를 설정하고 질문하면 여기 chat에서 현재 디렉토리의 sqlite 파일을 읽어서 그거에 대한 답을 해주게 하고 싶거든. 그런데 클로드를 그 llm 서버로 하고 싶은데, llm 서버 주소, 토큰, 모델명을 입력해야되는데 어디서 가져와서 하는지 모르겠어. 일단 클로드를 무료로 가입하긴 했어.


https://console.anthropic.com



20260517 202349 SETTINGS TEST REQUEST endpoint=https://api.anthropic.com/v1/messages model=claude-3-5-haiku-20241022 token=[set]
20260517 202350 SETTINGS TEST ERROR LLM request failed with status 404. request={"provider": "anthropic", "endpoint": "https://api.anthropic.com/v1/messages", "method": "POST", "model": "claude-3-5-haiku-20241022", "payload_keys": ["max_tokens", "messages", "model", "system", "temperature"]} response={"type":"error","error":{"type":"not_found_error","message":"model: claude-3-5-haiku-20241022"},"request_id":"req_011Cb84DBWyJj9yTGprS9y64"} available_models=claude-opus-4-7, claude-sonnet-4-6, claude-opus-4-6, claude-opus-4-5-20251101, claude-haiku-4-5-20251001, claude-sonnet-4-5-20250929, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-sonnet-4-20250514



채팅을 해봤는데, 한번 질답을 하면 이전 대화는 없어지더라고. 스크롤하면 이전 대화도 볼 수 있게 해주고, 질문 입력 창에 기본적인 기능 추가해줘. 아무것도 입력 안한 상태에서 키보드 위를 누르면 이전 질문, 한번 더 누르면 그 이전 질문, 아래는 다음 질문 이런 기능


여기 sample.db에서 customers 테이블에 대해 설명해줘


지금은 단순히 테이블에 대한 설명만 하는데, 이 테이블들에 대한 메타정보를 넣어둘테니, 그걸 기반으로 좀 더 나은 추론을 해서 답을 해줬으면 하거든. 테이블명.md나 skill01.md, skill02.md나 그런식으로 넘기고,그걸 참고로해서 답을 줬으면 하는데, 어떤식이 좋을지 추천해줘.


여기 repository에 숫자.db 파일은 다 지워주고, 남은 db 파일에 예제로 위 메타 파일을 만들어줘.


You
고객이 현재 몇명이야?
Context
mode: folder / db: 4
Databases:
sales.db (tables: 3) - sales.db
sample.db (tables: 3) - sample.db
support.db (tables: 3) - support.db
warehouse.db (tables: 3) - warehouse.db
Metadata Sources:
database/sales:sales.md
skill/sales:sales-skill01.md
skill/sales:sales-skill02.md
skill/global:skill01.md
skill/global:skill02.md
table/sample:sample.md
database/sample:sample.md
skill/sample:sample-skill01.md
skill/sample:sample-skill02.md
table/customers:customers.md
table/orders:orders.md
database/support:support.md
skill/support:support-skill01.md
skill/support:support-skill02.md
database/warehouse:warehouse.md
skill/warehouse:warehouse-skill01.md
skill/warehouse:warehouse-skill02.md
Answer
현재 고객은 3명입니다. (sample.db의 customers 테이블 기준, 전체 기간)
SQL
SELECT COUNT(DISTINCT id) AS 고객수 FROM customers; 이렇게 나오는데, context랑 sql은 그냥 Answer 아래 작은 버튼 두개로 해주고, 그걸 누르면 펼쳐서 현재드 정보가 나오게 해줘.



내가 너한테 질문하면 너 뭐 생각하면서 "Read app.chat.js" 뭐 이런게 나오잖아. 얘도 쿼리하는거나, 메타 정보 보는걸 이런식으로 나오게 해줘. 뭘 생각하고 있는지 보게.


md, skill 파일을 어떻게 작성하면 되는지 그 가이드 파일을 작성해줘. 젤 위에. guide.txt에 해줘.


md, skill에 내가 작성하고 싶은게, 그 테이블의 속성이 무슨 의미인지, 어떤식의 질문이 오는지,
어떤식으로 쿼리해야하는지등을 넣고,그걸 llm 하게 했으면 하거든.


여기 소스 분석해서 뭐하는건지 파악해줘.


여기 md 파일을 추가해서 llm에 전달하는데 그래서 context랑 trace가 나오거든. 근데 여기에 왜 그 md 파일을 선택했는지, 그 md에서 어떤걸 어떻게 사용했는지 이런것도 context 에 나오게 할 수 있을까?


output 창을 그 위에 split을 선택해서 마우스로 위로 올리거나, 내려서 크기를 조정하고 싶거든. 지금은 그냥 고정인거 같아. 수정해줘.



여기 repository에 sqlite 파일이 한 폴더에 있는데, 폴더를 하나 더 만들고 거기에 또 다른 관련된 sqlite 파일을 하나 만들어주고, 거기 샘플 데이터를 넣어줘. 그리고 그 폴더에 있는 내용이랑, 현재 있는 폴더 내용이랑 조인해서 대답을 해줬으면 하는데, 가능할까?


여기 sqlite 있는 폴더를 정할 수 있게 세팅에 추가해줘.
system, current, hist 폴더 이렇게 3개이고,
각 폴더 안엔 sqlite 파일들이 들어갈꺼야. 내가 사용하는 sqlite 파일들.
이 정보를 가지고 llm이 대답해줬으면 하거든.



여기 만든 폴더들 안에 대충 샘플 sqlite 파일들을 몇개 만들어줘. 지금 있는걸 응용해서 만들어줘도 되.


여기 세개 폴더를 대상으로 건너서 쿼리하고, 여러번 쿼리해야 답을 줄 수 있는 질문을 대충 5개 정도 줘봐.

좋아요. 아래 5개는 system/current/hist 3개 폴더를 가로질러 보고, 보통 한 번의 SQL로 끝나지 않고 여러 쿼리/검증이 필요한 질문들입니다.


현재(current)의 GOLD 고객 중에서, 과거(hist) 캠페인 참여 이력이 있고, 시스템(system) 상태가 WARN인 시점 이후 주문이 늘어난 고객은 누구야? 증가율도 보여줘.
current의 캠페인 대상 고객 중 hist에서 이미 유사 캠페인(SPRING25 vs SPRING26)에 참여했던 고객 비율이 얼마인지, 그리고 system 코드맵 기준으로 고객 등급별 분포를 같이 보여줘.
hist에서 리딤 금액이 높았던 고객 상위 3명이 current에서도 고액 주문을 유지하는지 확인하고, 유지/하락 여부를 system의 레벨 코드 의미와 함께 설명해줘.
system 알림(WARN) 발생 전후로 current 주문 건수/금액이 어떻게 변했는지, 그리고 동일 고객의 hist 주문 패턴과 비교해서 이상 징후가 있는 고객을 찾아줘.
current의 캠페인 대상 중 hist에서 반응(리딤) 기록이 없던 고객만 추려서, system 코드맵 기준 등급별로 다음 캠페인 우선순위 후보를 추천해줘.


data explorer에서 파일명이 길어서 ...으로 끊어 나오는건
거기 마우스를 갖다대면 그 뒤에 full name이 툴팁으로 나오게 해줘.


채팅창에서 질문을 입력하는 부분을 좀 멋있게 바꿔줘. 
vs code에 있는 copilot chat 처럼 send하는 화살표 버튼을 내가 질문을 하면 화살표에서 중지 버튼으로 바꼈다가, 그 답이 오는 사이 파란색선이 돌면서 답변중이라는 표시? 그런게 되게 해줘. 뭔지 알지?


질문을 입력하는 창 테두리 전체가 계속 파란게 아니라, 한 1/4 정도만 파란색이 보이고 그게 선처럼 이 창 테두리를 빙빙 도는? 그런 모양으로 해줘.


답변이 다 되면 너가 답변 끝났을때 평가하는것처럼
좋아요, 싫어요, 복사, 다시 등을 아이콘으로 아래 표시하고 누르면 그렇게 동작하게 해줘.



좋아요. 아래 5개는 system/current/hist 3개 폴더를 가로질러 보고, 보통 한 번의 SQL로 끝나지 않고 여러 쿼리/검증이 필요한 질문들입니다.

현재(current)의 GOLD 고객 중에서, 과거(hist) 캠페인 참여 이력이 있고, 시스템(system) 상태가 WARN인 시점 이후 주문이 늘어난 고객은 누구야? 증가율도 보여줘.
current의 캠페인 대상 고객 중 hist에서 이미 유사 캠페인(SPRING25 vs SPRING26)에 참여했던 고객 비율이 얼마인지, 그리고 system 코드맵 기준으로 고객 등급별 분포를 같이 보여줘.
hist에서 리딤 금액이 높았던 고객 상위 3명이 current에서도 고액 주문을 유지하는지 확인하고, 유지/하락 여부를 system의 레벨 코드 의미와 함께 설명해줘.
system 알림(WARN) 발생 전후로 current 주문 건수/금액이 어떻게 변했는지, 그리고 동일 고객의 hist 주문 패턴과 비교해서 이상 징후가 있는 고객을 찾아줘.
current의 캠페인 대상 중 hist에서 반응(리딤) 기록이 없던 고객만 추려서, system 코드맵 기준 등급별로 다음 캠페인 우선순위 후보를 추천해줘.




내가 대화창에서 전체 내용을 복사하려고 ctrl + a를 눌렀는데, output에 있는 텍스트까지 선택이 됐어. 이거 구분하게 해줘.


llm 서버로 질믄을 보낼때, http hdr에 다음 정보를 설정할 수 있게 해줘. setting 에서. 뭐냐면 HTTP-Referer, X-Title, User-Agent


내 파이썬 가상 환경을 workon v1으로 사용하고 있어


내 파이썬 가상 환경을 workon v1으로 사용하고 있어. 여기 setting에서 저장하고 다음에 또 키면 전에 입력했던걸 저장했다가 보여주고, 그걸로 쓰게 되는거야?


여기 setting에 보면 llm 서버주소, 토큰, 모델명은 기본으로 들어가는거고,
그 외에 http-referer, x-title, user-agent등이 있는데, 이건 없애주고, 대신 additional header, additional payload를 추가해줘.
여기 json 형식으로 넣으면 네가 그 서버에 요청할떄, 이 정보도 같이 추가해서 보내게 해줘. llm 서버마다 필요한 설정이 달라서 말이야.


여기 additional header를 추가했는데,
여기 값을 어떤식으로 넣어야하는지, 예제를 보여줘. 내가 넣으니까 안되는거 같아.

{
"Send-System-Name": "planground",
"User-Type": "AD_ID"
}




아, 찾은듯해. 

{
"Send-System-Name": "planground",
"User-Type": "AD_ID"
}
이렇게 설정했는데
post할때,다음처럼 가네.
"additional_headers": "{\n\"Send-System-Name\": \"planground\",\n\"User-Type\": \"AD_ID\"\n}"

원래 header에 "Send-System-Name": "planground",
"User-Type": "AD_ID" 만 더 넣으면 되는건데.



여기 data explorer에서 sql 결과나, 테이블 결과에서 cell을 선택하고 키보드로 좌우 이동하면 cell이 이동하는게 아니라, 그 전체 그리드의 스크롤이 이동하는거 같아. 


해결이 안됐어. sql을 선택하고, cell을 선택한뒤 방향키를 누르면, 다시 sql 에디트창에서 캐럿이 움직여.


내가 리눅스에서 이걸 실행하는데, 여기 파일이 한 1.5만개 있거든. 해보니까 timeout 에러나는데, 퀵하게 화면을 갱신하는 방법이 있을까?


data explorer에 파일 리스트 아래에 이 폴더에 대한 설명 있잖아.
폴더 몇개, 파일 몇개, 용량. 그게 잘 안 보이는데,
일단 글자가 작고, 바탕은 밝은 회색인데, 글자가 흰색이라 그런것 같아.
보기 좋게 바꿔줘.


그리고 sqlite 파일이 너무 큰 경우에 다 로딩하면 오래 걸리니까 max 10000줄까지만 loading하게 해줘.


응 그거 표시해주고, data explorer에서 ctrl + a 누르면 output창에 있는 텍스트까지 선택이 되는데, 정상인지 확인하고 수정해줘.


쿼리 실행한 다음에 나오는 그리드에서 셀을 선택하는거랑, 그냥 테이블 텝에 있는 그리드에서 선택하는거랑 다른거 같거 같은데, 테이블 있는 그리드에서 선택하면 잘 안되는거 같아. 확인해줘.



abcd
efg


---

## 기획안

## 1. 프로젝트 개요

`websqlitebrowser`는 웹에서 SQLite 파일을 탐색하고 조회할 수 있는 브라우저 기반 도구다.
주 사용 환경은 Windows와 Linux이며, 서버에서 접근 가능한 디렉토리 내 SQLite 파일을 찾아 열람하고,
테이블 조회, 직접 쿼리 실행, LLM 기반 질의응답 기능까지 제공하는 것을 목표로 한다.

이 프로그램은 SQLite 파일을 직접 생성하거나 외부 시스템과 동기화하는 역할보다는,
이미 다른 시스템이 생성 및 갱신하는 SQLite 파일에 대해 읽기 중심의 탐색/조회 경험을 제공하는 데 집중한다.

## 2. 목표

### 핵심 목표

1. 서버 디렉토리 내 SQLite 파일을 쉽게 탐색할 수 있어야 한다.
2. 선택한 SQLite 파일의 테이블과 데이터를 탭 기반으로 빠르게 조회할 수 있어야 한다.
3. 사용자가 직접 SQL을 실행하고 결과를 즉시 확인할 수 있어야 한다.
4. 설정한 LLM 서버 정보를 기반으로 현재 서버 내 SQLite 데이터에 대해 자연어 질의응답이 가능해야 한다.
5. Windows/Linux 환경 차이를 고려한 경로 처리와 운영 방식을 가져야 한다.

### 비목표

1. SQLite 파일 자체의 생성/수정 워크플로우 관리
2. 외부 시스템과의 동기화 처리
3. 대규모 DBMS 수준의 권한 관리/트랜잭션 관리
4. 복잡한 SQL IDE 수준의 편집 기능 제공

## 3. 주요 사용자 시나리오

### 시나리오 1: SQLite 파일 탐색

1. 사용자가 웹에 접속한다.
2. 좌측 사이드바에서 `Data Explorer`를 연다.
3. 서버에서 허용된 루트 경로 아래 디렉토리/파일 구조를 탐색한다.
4. `.sqlite`, `.db`, `.sqlite3` 같은 파일을 선택한다.
5. `View`를 눌러 해당 DB를 연다.

### 시나리오 2: 테이블 데이터 확인

1. DB를 열면 우측 메인 영역에 탭이 생성된다.
2. 첫 번째 기본 탭은 `Query`다.
3. 그 외 탭은 DB에 포함된 테이블 이름으로 생성된다.
4. 사용자는 테이블 탭을 눌러 샘플 레코드나 전체 목록을 조회한다.

### 시나리오 3: SQL 직접 실행

1. `Query` 탭 상단 영역에 SQL을 입력한다.
2. 실행 버튼을 누른다.
3. 하단 결과 영역에 컬럼/행 단위로 결과가 표시된다.
4. 오류가 있으면 SQL 에러 메시지를 표시한다.

### 시나리오 4: 자연어 기반 질의응답

1. 사용자가 `Setting`에서 LLM 서버 주소, 토큰, 모델명을 입력한다.
2. `Chat` 화면에서 자연어 질문을 입력한다.
3. 시스템이 선택된 DB 또는 현재 탐색 가능한 DB 범위를 기준으로 질의를 해석한다.
4. 필요한 경우 내부적으로 SQL을 생성/실행한 뒤 결과를 기반으로 답변한다.

## 4. 기능 요구사항

### 4.1 Data Explorer

1. 서버 기준 허용된 루트 디렉토리를 탐색할 수 있어야 한다.
2. 디렉토리와 파일을 트리 또는 리스트 형태로 표시해야 한다.
3. SQLite 확장자 파일을 식별해서 표시해야 한다.
4. 파일 선택 시 해당 DB의 메타데이터를 읽을 수 있어야 한다.
5. 테이블 목록, 스키마 정보, 기본 조회 결과를 가져올 수 있어야 한다.

### 4.2 DB 뷰어

1. 메인 영역은 탭 기반 인터페이스여야 한다.
2. 첫 탭은 항상 `Query` 탭이어야 한다.
3. 나머지 탭은 테이블 이름 기준으로 생성한다.
4. 각 테이블 탭에서는 기본 조회 결과를 테이블 형태로 보여준다.
5. 데이터가 많을 경우 페이지네이션 또는 제한 조회가 필요하다.

### 4.3 Query 실행기

1. `Query` 탭은 상하 분할 레이아웃이어야 한다.
2. 상단은 SQL 입력 영역이다.
3. 하단은 SQL 결과 표시 영역이다.
4. 읽기 전용 중심으로 설계하되, 초기 버전에서는 `SELECT`, `PRAGMA`, `WITH` 위주 허용 여부를 우선 검토한다.
5. 쓰기 쿼리 허용 여부는 운영 정책으로 분리한다.

### 4.4 Setting

1. LLM 서버 주소 입력
2. API 토큰 입력
3. 모델명 입력
4. 연결 테스트 기능
5. 설정 저장/불러오기 기능

### 4.5 Chat

1. 자연어 질문 입력 UI 제공
2. 현재 선택된 DB 컨텍스트를 기반으로 답변 생성
3. 필요 시 생성된 SQL과 실행 결과를 함께 표시하는 옵션 제공
4. 실패 시 원인 표시: 설정 누락, 연결 실패, SQL 실패, 대상 DB 미선택 등

## 5. 화면 기획

### 전체 레이아웃

1. 좌측: 사이드바
2. 우측: 메인 작업 영역

### 좌측 사이드바 구조

1. 하단 고정 메뉴: `Data Explorer`, `Chat`, `Setting`
2. 상단 콘텐츠 영역: 현재 선택된 메뉴의 상세 내용 표시

### 우측 메인 영역 구조

1. 상단: 현재 열린 DB 정보 또는 경로 표시
2. 중앙: 탭 영역
3. 탭 구성:
	- `Query`
	- 테이블별 탭
4. `Query` 탭 내부:
	- 상단 SQL 에디터
	- 하단 결과 테이블

## 6. 기술 방향

### 백엔드

1. 프레임워크: Django
2. 역할:
	- 파일 시스템 탐색 API
	- SQLite 메타데이터 조회 API
	- SQL 실행 API
	- 설정 저장 API
	- LLM 연동 API

### 프론트엔드

1. 기본: JavaScript
2. 선택지:
	- Django Template + Vanilla JS
	- Django Template + HTMX/Alpine.js
	- 분리형 SPA 구조
3. 초기 개발 생산성을 고려하면 Django Template + 경량 JS 구조가 1차 구현에 적합하다.

### DB 접근 정책

1. Python의 `sqlite3` 사용
2. 다중 파일 대상 접근 지원
3. 파일 잠금 또는 외부 업데이트 상황을 고려한 예외 처리 필요
4. 대용량 조회 시 row limit 필요

## 7. 운영 및 환경 고려사항

### 운영체제 경로 처리

1. Windows와 Linux 모두 지원해야 한다.
2. 경로 처리는 문자열 조합이 아니라 Python의 `pathlib` 기준으로 통일한다.
3. 허용 루트 경로는 설정 파일 또는 환경변수로 관리한다.
4. 사용자가 임의의 시스템 전체 경로를 탐색하지 못하도록 루트 제한이 필요하다.

### 보안

1. 임의 경로 접근 방지
2. SQL 실행 제한 정책 필요
3. LLM 토큰 암호화 또는 최소한 마스킹 저장 고려
4. 민감 정보가 채팅 응답에 그대로 노출되지 않도록 방어 필요

### 안정성

1. 외부 시스템이 SQLite를 업데이트 중일 수 있으므로 읽기 실패/잠금 예외 처리 필요
2. 결과 조회 시 타임아웃/row limit 필요
3. 잘못된 SQL과 LLM 실패를 UI에서 명확히 분리해 표시해야 한다.

## 8. 권장 아키텍처

### 백엔드 모듈

1. `file_browser`: 허용 경로 탐색
2. `sqlite_service`: DB 연결, 테이블 목록, 스키마, 쿼리 실행
3. `settings_service`: LLM 설정 저장/조회
4. `chat_service`: 프롬프트 생성, SQL 생성, 응답 반환

### 프론트엔드 모듈

1. `sidebar`: 메뉴 전환
2. `explorer-panel`: 디렉토리/파일 탐색
3. `db-tabs`: Query/테이블 탭 렌더링
4. `query-runner`: SQL 실행 및 결과 표시
5. `settings-panel`: LLM 설정 입력
6. `chat-panel`: 대화 UI 및 응답 렌더링

## 9. 단계별 개발 계획

### 1단계: 기본 탐색기 + DB 열기

1. Django 프로젝트 생성
2. 파일 탐색 API 구현
3. SQLite 파일 선택 및 열기 구현
4. 테이블 목록 조회 구현
5. 기본 UI 레이아웃 구현

### 2단계: 테이블 조회 + Query 탭

1. 테이블별 탭 렌더링
2. 기본 `SELECT * LIMIT N` 조회
3. Query 탭 상하 분할 UI 구현
4. SQL 실행 API 연결
5. 오류/결과 표시 정리

### 3단계: Setting + Chat

1. LLM 설정 저장 UI/API 구현
2. 연결 테스트 기능 구현
3. 자연어 질문 -> SQL 생성/실행 흐름 구현
4. 답변 + 근거 SQL 표시 옵션 구현

### 4단계: 안정화

1. 경로 제한 및 보안 점검
2. SQL 허용 정책 정리
3. 예외 처리 및 메시지 개선
4. Windows/Linux 경로 테스트
5. 대용량 결과 처리 보완

## 10. MVP 범위 제안

초기 MVP는 아래 범위로 제한하는 것이 적절하다.

1. 서버 로컬 디렉토리 탐색
2. SQLite 파일 선택 및 열기
3. 테이블 목록 표시
4. 테이블 데이터 조회
5. `Query` 탭에서 읽기 전용 SQL 실행
6. 기본 설정 화면

`Chat` 기능은 2차 기능으로 분리해도 되지만, 기획상 중요도가 높다면 인터페이스만 먼저 만들고
실제 LLM 실행은 후속 단계에서 붙이는 방식이 현실적이다.

## 11. 오픈 이슈

1. SQL 실행을 읽기 전용으로 강제할지 여부
2. 여러 DB를 동시에 열 수 있게 할지 여부
3. 설정 저장 위치를 DB, 파일, 환경변수 중 어디로 둘지 여부
4. Chat이 현재 선택된 DB만 볼지, 전체 탐색 가능 DB를 볼지 여부
5. 인증이 필요한 내부 서비스로 운영할지 여부

## 12. 결론

이 프로젝트는 "파일 탐색 + SQLite 조회 + SQL 실행 + LLM 질의응답"을 결합한 운영형 웹 도구다.
기능은 많지만, 실제 구현은 `Data Explorer -> DB Viewer -> Query -> Setting -> Chat` 순으로 나누면 충분히 단계적으로 진행할 수 있다.

가장 먼저는 읽기 전용 MVP를 완성하고, 이후 Chat/LLM 기능을 확장하는 방향이 가장 안전하다.

