MyLearner @EDITION@ v@VERSION@ - 내가 넣은 자료로 매일 배우고 복습하는 1인용 학습 앱

1. 여는 법
   가. 서버 모드(권장, Python 3.9 이상이 있을 때)
       - Windows: 이 폴더의 MyLearner.cmd 를 두 번 누른다.
         또는 명령 창에서 이 폴더로 가서  py -3 -m mylearner serve
       - 창에 찍힌 주소(http://127.0.0.1:@PORT@/?token=...)가 브라우저로 열린다. 열리지 않으면 그 주소를 Chrome 에 붙여 넣는다.
       - 기록은 이 폴더의 data\log.jsonl 에 저장된다. 끄려면 창에서 Ctrl+C.
   나. 더블클릭(Python 이 없을 때)
       - web\index.html 을 Chrome 으로 연다. 기록은 그 브라우저 안(localStorage)에 저장된다.
       - 서버 모드와 더블클릭은 서로 다른 기기로 센다(기록이 따로 쌓인다). 한 가지로 쓴다.

2. MWL(MiddlewareLearner) 진도 이어 가기
   - MWL 의 설정 -> 진도 내보내기(JSON) 로 파일을 받고, MyLearner 의 과정 -> MWL 진도 들여오기에서 고른다.
   - 여러 번 들여와도 된다(병행). 들여오기 전에 기록 전체를 백업한다.

3. 백업
   - 들여오기 전과 하루 첫 저장 때 기록 전체를 남긴다(서버 모드: data\backups\).
   - data 폴더를 통째로 복사해 두면 그대로 되살릴 수 있다.

4. 문제가 있을 때
   - "포트 ... 를 열 수 없습니다": 이미 켜져 있다. 그 창을 쓰거나 끈 뒤 다시 켠다. 다른 포트: py -3 -m mylearner serve --port 8771
   - "접속 토큰이 필요합니다": 서버 창에 찍힌 주소(끝에 ?token=...)로 연다. 토큰은 data\token 파일에도 있다.
