/* MyLearner web/core/constants.js — 도메인 상수 한 곳(CLAUDE.md 5절, docs/설계서_Architecture.md 6절).
 * 입력: 없음 / 출력: MyLearner.constants / 트리거: 다른 core 파일이 가장 먼저 읽는다
 * 문서: docs/P2_요구사항정의서_Core.md FR-202, docs/P2_설계서_Core.md 2·4절
 * SM-2·숙련도·계획 기본값은 MWL web/engine.js(MiddlewareLearner@e55b9c0) 머리에서 옮겼다.
 * SHARED 묶음은 mylearner/constants.py 의 SHARED 와 같아야 한다(tests/unit/py/test_constants_shared.py 가 본다) — 엄격한 JSON 으로 쓴다. */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var mod = factory();
  if (node) module.exports = mod; else (root.MyLearner = root.MyLearner || {}).constants = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SHARED = /* SHARED-BEGIN */ {
    "COURSE_FORMAT": "mylearner-course",
    "COURSE_VERSION": 1,
    "COURSE_MIN_READER": 1,
    "COURSE_READER": 1,
    "LOG_FORMAT": "mylearner-log",
    "LOG_VERSION": 1,
    "LOG_MIN_READER": 1,
    "LOG_READER": 1,
    "EVENT_VERSION": 1,
    "COURSE_ID_RE": "^[a-z0-9][a-z0-9-]{0,39}$",
    "ITEM_ID_RE": "^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$",
    "COURSE_KINDS": ["course", "notes"],
    "CONFIDENCE_LEVELS": ["verified", "likely", "unverified"],
    "QUIZ_ITEM_TYPES": ["mcq", "multi", "short", "order"],
    "LAB_CHECK_TYPES": ["choice", "text", "regex"],
    "MWL_COURSE_ID": "mwl",
    "MWL_NOTES_ID": "mwl-notes"
  } /* SHARED-END */;

  // SM-2 (MWL engine.js 와 같다 — 골든 벡터 tests/fixtures/mwl/srs_vectors.json)
  var SM2 = { initial_ef: 2.5, min_ef: 1.3, first_interval: 1, second_interval: 3, easy_first_interval: 3,
    hard_multiplier: 1.2, easy_bonus: 1.3, again_penalty: 0.2, hard_penalty: 0.15, easy_reward: 0.15, max_interval: 180 };
  var GRADES = ['again', 'hard', 'good', 'easy'];
  var GRADE_VALUES = { again: 0, hard: 1, good: 2, easy: 3 };
  var GRADES_KEEP = 20;
  var SECONDS_PER_CARD = 15;
  var PASS_SCORES = { quiz: 70, drill: 80 };
  var MASTERY_THRESHOLDS = { retention_l2: 0.70, retention_l4: 0.85, quiz_l3: 70, drill_l4: 80 };
  var MASTERY_LEVELS = { 0: '미학습', 1: '인지', 2: '이해', 3: '적용', 4: '진단', 5: '전수' };
  // 하루 계획 기본값(MWL SESSION_DEFAULTS 에서 서버 값을 뺐다) + 학습일 경계(인터뷰 2번 — 자정)
  var PLAN_DEFAULTS = { weekday_minutes: 50, weekend_minutes: 15, weekend_review_only: true, max_reviews_per_day: 40,
    new_cards_per_day: 12, study_days: [1, 2, 3, 4, 5], day_start_hour: 0, main_course: null, plan_variants: {} };

  // 사건(docs/P2_설계서_Core.md 3.3절)
  var EVENT_TYPES = ['review', 'card.state', 'card.hold', 'lesson', 'lab', 'drill', 'quiz', 'check', 'session', 'journal', 'setting'];
  var EVENT_RANK = { 'card.state': 1 };   // 그날의 다른 사건 뒤에 온다. 나머지는 0
  var DEVICE_RE = '^[a-z0-9][a-z0-9-]{0,31}$';
  var TIME_RE = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
  var DAY_RE = '^\\d{4}-\\d{2}-\\d{2}$';
  var TYPE_RE = '^[a-z][a-z0-9.]{0,31}$';
  var SETTING_KEY_RE = '^[a-z][a-z0-9_.]{0,63}$';   // 글자로 시작 — '__proto__' 같은 키를 받지 않는다(독립 점검 F5)
  var FUTURE_DAYS = 1;          // 계산하는 날 + 1 까지는 받는다(시계 어긋남)
  var MAX_SEQ = 9007199254740991;

  // 렌더러·채점
  var RENDER_MAX_DEPTH = 16;
  var REGEX_MAX_PATTERN = 200;
  var REGEX_MAX_INPUT = 500;
  var REGEX_MAX_PROGRAM = 2000;  // 실습 정규식을 엮은 명령 수 상한 — 맞춰 보기가 O(명령 × 답) 이라 2000 × 500 = 100만 걸음 안(regex.js)
  var MAX_REPORTED = 200;        // 과정 검사가 담는 오류·경고 수(수는 모두 센다)

  return { SHARED: SHARED, SM2: SM2, GRADES: GRADES, GRADE_VALUES: GRADE_VALUES, GRADES_KEEP: GRADES_KEEP,
    SECONDS_PER_CARD: SECONDS_PER_CARD, PASS_SCORES: PASS_SCORES, MASTERY_THRESHOLDS: MASTERY_THRESHOLDS,
    MASTERY_LEVELS: MASTERY_LEVELS, PLAN_DEFAULTS: PLAN_DEFAULTS, EVENT_TYPES: EVENT_TYPES, EVENT_RANK: EVENT_RANK,
    DEVICE_RE: DEVICE_RE, TIME_RE: TIME_RE, DAY_RE: DAY_RE, TYPE_RE: TYPE_RE, SETTING_KEY_RE: SETTING_KEY_RE,
    FUTURE_DAYS: FUTURE_DAYS, MAX_SEQ: MAX_SEQ, RENDER_MAX_DEPTH: RENDER_MAX_DEPTH,
    REGEX_MAX_PATTERN: REGEX_MAX_PATTERN, REGEX_MAX_INPUT: REGEX_MAX_INPUT, REGEX_MAX_PROGRAM: REGEX_MAX_PROGRAM, MAX_REPORTED: MAX_REPORTED };
});
