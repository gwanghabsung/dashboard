/**
 * Police Maker - API 모듈 (v2 - 데이터 캐싱 추가)
 *
 * 책임:
 *   1. URL에서 ?token 읽기
 *   2. 디렉터리 API 호출 → 학생 정보 받아오기
 *   3. 학생 시트에 GET/POST (fetch 래퍼)
 *   4. 학생 데이터를 localStorage에 캐시 → 재방문 시 즉시 표시
 */
(function() {
  'use strict';

  var CONFIG = window.POLICEMAKER_CONFIG || {};

  // ───────────────────────────── 상태 ─────────────────────────────

  var resolvedStudent = null;
  var resolvePromise  = null;

  // ───────────────────────────── 토큰 / URL 관리 ─────────────────────────────

  var TOKEN_STORAGE_KEY = 'pm_active_token';

  /**
   * 토큰 획득 우선순위:
   *   1) URL 파라미터 ?token=xxx  → 즉시 localStorage에 저장하고 URL에서 제거
   *   2) localStorage에 저장된 값
   *
   * URL에서 토큰을 빼는 이유:
   *   - 어깨너머 노출, 카톡/디스코드 공유 시 우발적 유출, 브라우저 히스토리 보존 방지
   *   - F12로 보는 사람한테는 여전히 보임 (이건 OAuth로만 막을 수 있음)
   */
  function getTokenFromUrl() {
    try {
      var params = new URLSearchParams(window.location.search);
      var urlToken = (params.get('token') || '').trim();

      if (urlToken) {
        // 새 토큰이 URL에 있으면 우선 적용 + URL에서 제거
        // ⭐ sessionStorage 사용 — 탭별 격리 (다른 탭에서 다른 학생 토큰 열어도 영향 X)
        try { sessionStorage.setItem(TOKEN_STORAGE_KEY, urlToken); } catch (e) {}
        // URL 정리 (페이지 새로고침 없이)
        try {
          var url = new URL(window.location.href);
          url.searchParams.delete('token');
          var newSearch = url.searchParams.toString();
          var clean = url.pathname + (newSearch ? '?' + newSearch : '') + url.hash;
          history.replaceState({}, '', clean);
        } catch (e) {}
        return urlToken;
      }

      // URL에 토큰 없으면 sessionStorage에서 복원 (이 탭에서만 유효)
      try {
        var saved = sessionStorage.getItem(TOKEN_STORAGE_KEY);
        if (saved) return saved.trim();
      } catch (e) {}

      return '';
    } catch (e) { return ''; }
  }

  /**
   * 학생이 로그아웃 효과 — 토큰과 모든 캐시 제거
   */
  function clearToken() {
    try {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch (e) {}
    clearCache();
  }

  function getDirectoryUrl() {
    return (CONFIG.DIRECTORY_API_URL || '').trim();
  }

  function cacheKey(token) {
    return 'pm_student_v1::' + token;
  }

  function dataCacheKey(token) {
    return 'pm_data_v1::' + token;
  }

  // ⭐ 범용 캐싱 wrapper — 빈출 등 자주 안 바뀌는 데이터를 localStorage에 캐시.
  //   key: 짧은 식별자 ('ft_progress' 등)
  //   ttlMs: TTL (밀리초)
  //   apiCall: () => Promise<data>
  //
  //   동작: TTL 안 지난 캐시 있으면 즉시 Promise.resolve(캐시).
  //         없거나 만료면 apiCall 호출 → 결과 캐시 + 반환.
  //
  //   캐시 무효화는 invalidateCache(prefix)로. 학생이 데이터 변경하는 시점에 호출.
  function genericCacheKey_(key) {
    var ver = (CONFIG && CONFIG.CACHE_VERSION) || 1;
    var t = getTokenFromUrl() || 'anon';
    return 'pm_cache_v' + ver + '::' + t + '::' + key;
  }

  function cachedGet(key, ttlMs, apiCall) {
    // 1) 캐시 시도
    try {
      var raw = localStorage.getItem(genericCacheKey_(key));
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && obj.ts && (Date.now() - obj.ts) < ttlMs) {
          // 캐시 hit — 즉시 반환
          return Promise.resolve(obj.data);
        }
      }
    } catch (e) { /* 파싱 실패 등 — 그냥 API 호출 */ }

    // 2) 캐시 miss — API 호출 후 저장
    return apiCall().then(function(data) {
      try {
        localStorage.setItem(genericCacheKey_(key), JSON.stringify({
          ts: Date.now(),
          data: data
        }));
      } catch (e) { /* localStorage 가득 차거나 비활성 — 무시 */ }
      return data;
    });
  }

  /**
   * 캐시 무효화 — 학생이 데이터 변경 시 호출 (예: 빈출 풀이 저장 후).
   *   prefix: 'ft_' 같은 prefix로 여러 키 한 번에 무효화 가능.
   *           정확한 키 ('ft_progress')만 무효화도 가능.
   */
  function invalidateCache(prefix) {
    if (!prefix) return;
    var fullPrefix = genericCacheKey_(prefix);
    var keysToRemove = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(fullPrefix) === 0) keysToRemove.push(k);
      }
      keysToRemove.forEach(function(k) { localStorage.removeItem(k); });
    } catch (e) { /* 무시 */ }
  }

  function readCache(token) {
    if (!CONFIG.URL_CACHE_TTL_MS || CONFIG.URL_CACHE_TTL_MS <= 0) return null;
    try {
      var raw = localStorage.getItem(cacheKey(token));
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.savedAt || !obj.data) return null;
      if (Date.now() - obj.savedAt > CONFIG.URL_CACHE_TTL_MS) {
        localStorage.removeItem(cacheKey(token));
        return null;
      }
      return obj.data;
    } catch (e) { return null; }
  }

  function writeCache(token, data) {
    if (!CONFIG.URL_CACHE_TTL_MS || CONFIG.URL_CACHE_TTL_MS <= 0) return;
    try {
      localStorage.setItem(cacheKey(token), JSON.stringify({
        savedAt: Date.now(),
        data: data
      }));
    } catch (e) { /* */ }
  }

  function clearCache(token) {
    try {
      if (token) {
        localStorage.removeItem(cacheKey(token));
        localStorage.removeItem(dataCacheKey(token));
      } else {
        var keys = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && (k.indexOf('pm_student_v1::') === 0 || k.indexOf('pm_data_v1::') === 0)) {
            keys.push(k);
          }
        }
        keys.forEach(function(k) { localStorage.removeItem(k); });
      }
    } catch (e) { /* */ }
  }

  // ───────────────────────────── 학생 데이터 캐시 ─────────────────────────────

  function readDataCache() {
    var token = getTokenFromUrl();
    if (!token) return null;
    try {
      var raw = localStorage.getItem(dataCacheKey(token));
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.data) return null;
      // 7일 넘은 데이터는 폐기
      if (obj.savedAt && Date.now() - obj.savedAt > 7 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(dataCacheKey(token));
        return null;
      }
      return {
        data: obj.data,
        savedAt: obj.savedAt || 0
      };
    } catch (e) { return null; }
  }

  function writeDataCache(data) {
    var token = getTokenFromUrl();
    if (!token) return;
    try {
      localStorage.setItem(dataCacheKey(token), JSON.stringify({
        savedAt: Date.now(),
        data: data
      }));
    } catch (e) { /* */ }
  }

  // ───────────────────────────── HTTP 헬퍼 ─────────────────────────────

  // ⭐ fetchJson — 옵션으로 자동 재시도 지원 (v181)
  //   retryOpts: { retries: N, backoffMs: [500, 1000] }
  //   재시도 대상 (isTransient=true): 네트워크 에러, timeout, JSON 파싱 실패(GAS가 HTML 404 반환하는 케이스), 5xx status
  //   GET은 idempotent라 안전. POST는 명시적으로 opts.retry=true 지정한 것만.
  function fetchJson(url, options, retryOpts) {
    options = options || {};
    retryOpts = retryOpts || {};
    var maxRetries = Math.max(0, Number(retryOpts.retries) || 0);
    var backoffMs = retryOpts.backoffMs || [500, 1000, 2000];
    var attempt = 0;

    function _attempt() {
      // 매 시도마다 새 AbortController + 타이머 (이전 타이머 재사용 X)
      var timeout = CONFIG.REQUEST_TIMEOUT_MS || 30000;
      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var attemptOpts = {};
      Object.keys(options).forEach(function(k) { attemptOpts[k] = options[k]; });
      if (controller) attemptOpts.signal = controller.signal;
      var timer = setTimeout(function() {
        if (controller) controller.abort();
      }, timeout);

      return fetch(url, attemptOpts)
        .then(function(res) {
          clearTimeout(timer);
          // 5xx status는 응답 본문 파싱 전에 재시도 대상으로 마킹
          var isServerError = res.status >= 500 && res.status < 600;
          return res.text().then(function(text) {
            try {
              var json = JSON.parse(text);
              // JSON 파싱 성공했더라도 5xx면 재시도 (백엔드가 에러 응답을 JSON으로 준 경우)
              if (isServerError) {
                var e5 = new Error('서버 오류 (status ' + res.status + '): ' + (json.message || json.error || text.substring(0, 200)));
                e5.status = res.status;
                e5.isTransient = true;
                throw e5;
              }
              return json;
            } catch (e) {
              // JSON.parse 실패 케이스 — 위 throw e5도 여기 catch됨
              if (e.isTransient) throw e;  // 이미 마킹된 재시도 대상은 그대로
              var errParse = new Error('서버 응답이 JSON이 아닙니다 (status ' + res.status + '): ' +
                              text.substring(0, 200));
              errParse.status = res.status;
              // JSON 파싱 실패는 재시도 대상 (GAS가 일시적으로 HTML 404 반환하는 케이스)
              errParse.isTransient = true;
              throw errParse;
            }
          });
        })
        .catch(function(err) {
          clearTimeout(timer);
          // timeout (AbortError)
          if (err.name === 'AbortError') {
            var errTimeout = new Error('요청 시간이 초과됐어요. 다시 시도해주세요.');
            errTimeout.isTransient = true;
            err = errTimeout;
          }
          // 네트워크 에러 (fetch 자체 실패) — TypeError로 던져짐
          if (err instanceof TypeError) {
            err.isTransient = true;
          }

          // 재시도 판정
          if (err.isTransient && attempt < maxRetries) {
            attempt++;
            var delay = backoffMs[attempt - 1] || backoffMs[backoffMs.length - 1] || 1000;
            try { console.warn('[fetch 재시도 ' + attempt + '/' + maxRetries + '] ' + delay + 'ms 후 재시도:', err.message); } catch (_) {}
            return new Promise(function(resolve) { setTimeout(resolve, delay); }).then(_attempt);
          }
          throw err;
        });
    }

    return _attempt();
  }

  // ───────────────────────────── 디렉터리 해석 ─────────────────────────────

  function resolveStudent() {
    if (resolvedStudent) return Promise.resolve(resolvedStudent);
    if (resolvePromise) return resolvePromise;

    var token = getTokenFromUrl();
    if (!token) {
      return Promise.reject(new Error('TOKEN_REQUIRED: URL에 ?token=... 이 없어요.'));
    }

    var cached = readCache(token);
    if (cached && cached.webAppUrl) {
      resolvedStudent = cached;
      return Promise.resolve(cached);
    }

    var dirUrl = getDirectoryUrl();
    if (!dirUrl) {
      return Promise.reject(new Error(
        'DIRECTORY_URL_MISSING: config.js에 DIRECTORY_API_URL이 설정되지 않았어요.'
      ));
    }

    resolvePromise = fetchJson(dirUrl + (dirUrl.indexOf('?') >= 0 ? '&' : '?') +
                                'token=' + encodeURIComponent(token), { method: 'GET' })
      .then(function(json) {
        resolvePromise = null;
        if (!json.ok) {
          var msg = json.message || json.error || '디렉터리 응답 오류';
          throw new Error(json.error + ': ' + msg);
        }
        if (!json.student || !json.student.webAppUrl) {
          throw new Error('디렉터리 응답이 비어있어요.');
        }
        resolvedStudent = json.student;
        writeCache(token, json.student);
        return resolvedStudent;
      })
      .catch(function(err) {
        resolvePromise = null;
        throw err;
      });

    return resolvePromise;
  }

  // ───────────────────────────── 학생 시트 API 호출 ─────────────────────────────

  function callGet(action, params) {
    return resolveStudent().then(function(student) {
      var qs = 'action=' + encodeURIComponent(action);
      if (params) {
        Object.keys(params).forEach(function(k) {
          qs += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        });
      }
      var url = student.webAppUrl +
                (student.webAppUrl.indexOf('?') >= 0 ? '&' : '?') + qs;
      // GET은 idempotent — 자동 재시도 2회 (500ms, 1000ms backoff)
      return fetchJson(url, { method: 'GET' }, { retries: 2 });
    });
  }

  function callPost(action, payload, opts) {
    opts = opts || {};
    return resolveStudent().then(function(student) {
      var body = JSON.stringify({ action: action, payload: payload || {} });
      var fetchOpts = {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: body
      };
      // ⭐ keepalive — 페이지 unload 후에도 요청 보존 (optimistic UI용)
      if (opts.keepalive) fetchOpts.keepalive = true;
      // POST는 기본 재시도 없음 (중복 제출 위험). opts.retry=true 지정한 경우에만 재시도.
      //   → getFrequentTestProgress 등 GET-like POST에 사용. mutation(submit/save)에는 금지.
      var retryOpts = opts.retry ? { retries: 2 } : {};
      return fetchJson(student.webAppUrl, fetchOpts, retryOpts);
    });
  }

  function unwrap(promise) {
    return promise.then(function(json) {
      if (!json.ok) {
        throw new Error(json.message || json.error || '서버 오류');
      }
      return json;
    });
  }

  // ───────────────────────────── 공개 API ─────────────────────────────

  window.PoliceMakerAPI = {
    getToken:        getTokenFromUrl,
    getStudent:      resolveStudent,
    clearCache:      clearCache,
    clearToken:      clearToken,
    readDataCache:   readDataCache,
    writeDataCache:  writeDataCache,

    ping: function() {
      return unwrap(callGet('ping'));
    },
    getStudentData: function() {
      return unwrap(callGet('getStudentData')).then(function(json) {
        writeDataCache(json.data);  // 자동 캐싱
        return json.data;
      });
    },

    submitConditionReport: function(payload) {
      return unwrap(callPost('submitConditionReport', payload, { keepalive: true })).then(function(j) { return j.result; });
    },
    requestConditionReportEdit: function() {
      return unwrap(callPost('requestConditionReportEdit')).then(function(j) { return j.result; });
    },
    submitExamReport: function(payload) {
      return unwrap(callPost('submitExamReport', payload, { keepalive: true })).then(function(j) { return j.result; });
    },
    requestExamReportEdit: function() {
      return unwrap(callPost('requestExamReportEdit')).then(function(j) { return j.result; });
    },

    updateMotto: function(motto) {
      return unwrap(callPost('updateMotto', { motto: motto })).then(function(j) { return j.result; });
    },

    getGoalsData: function(day) {
      return unwrap(callGet('getGoalsData', { day: day || 2 })).then(function(j) { return j.data; });
    },

    // ⭐ NEW: 목표 페이지 v2 - 전체 컨텍스트 (학생정보 + 휴일 + 최근 리포트 + 4과목 목차)
    getGoalsContext: function() {
      return unwrap(callGet('getGoalsContext')).then(function(j) { return j.data; });
    },

    getMockExams: function() {
      return unwrap(callGet('getMockExams')).then(function(j) { return j.data; });
    },

    submitMockExam: function(payload) {
      return unwrap(callPost('submitMockExam', payload)).then(function(j) { return j.result; });
    },

    // ⭐ NEW: 휴일 신청/취소
    submitHolidayRequest: function(payload) {
      return unwrap(callPost('submitHolidayRequest', payload)).then(function(j) { return j.result; });
    },
    cancelHolidayRequest: function(payload) {
      return unwrap(callPost('cancelHolidayRequest', payload)).then(function(j) { return j.result; });
    },
    // ⭐ 이번주 휴일 디렉터리 sync — 학생 백엔드가 디렉터리에 push.
    //   token 자동 첨부 (학생 백엔드가 token으로 학생 식별 후 디렉터리 [이번주_휴일] 시트 갱신)
    syncThisWeekHolidays: function() {
      var payload = { token: getTokenFromUrl() };
      return unwrap(callPost('syncThisWeekHolidays', payload)).then(function(j) { return j.result; });
    },

    // ⭐ NEW: 강의 메모 저장
    saveLectureMemo: function(payload) {
      return unwrap(callPost('saveLectureMemo', payload)).then(function(j) { return j.result; });
    },

    // ⭐ NEW: 약점 — 목차+틀린횟수 조회 / 틀린횟수 저장 / 약점 진도표 생성
    getWeaknessData: function() {
      return unwrap(callGet('getWeaknessData')).then(function(j) { return j.data; });
    },
    saveWeaknessChecks: function(payload) {
      return unwrap(callPost('saveWeaknessChecks', payload)).then(function(j) { return j.result; });
    },
    generateWeaknessSchedule: function(payload) {
      return unwrap(callPost('generateWeaknessSchedule', payload || {})).then(function(j) { return j.result; });
    },

    // ═══════════════════════════════════════════════════════════
    // ⭐ NEW: 빈출 테스트 (중앙 디렉터리 Web App + 학생 시트)
    //   중앙: 문제 조회/채점 (정답 노출 X, 채점은 서버 쪽)
    //   학생: 풀이기록 저장/조회, 다음 회차 진행도
    // ═══════════════════════════════════════════════════════════

    // ── 중앙 디렉터리 호출 (DIRECTORY_API_URL) ──
    listFrequentTestRounds: function() {
      // { 헌법: [1,2,...,22], 형사법: [1,...,30], 경찰학: [1,...,30] }
      // 회차 목록은 거의 안 바뀜 (관리자가 추가할 때만) → 1시간 캐시
      return cachedGet('ft_rounds', 60 * 60 * 1000, function() {
        return callDirectoryGet({ action: 'listRounds' }).then(function(j) {
          if (!j.ok) throw new Error(j.message || j.error || '회차 목록 조회 실패');
          return j.data;
        });
      });
    },

    // ⭐ 그룹 비교 — 결과 화면용 (특정 과목/회차 평균)
    //   응답: { allAvg, allCount, groupAvg, groupCount }
    //   캐싱 5분 — 학생 본인 새 점수 저장 시 자동 무효화 (saveFrequentTestLog에서)
    getGroupComparison: function(params) {
      var keyParts = ['ft_gc', params.subject, String(params.round)];
      if (params.group) keyParts.push(params.group);
      return cachedGet(keyParts.join('_'), 5 * 60 * 1000, function() {
        return callDirectoryGet({
          action: 'getGroupComparison',
          subject: params.subject,
          round: params.round,
          group: params.group || ''
        }).then(function(j) {
          if (!j.ok) throw new Error(j.message || j.error || '그룹 비교 조회 실패');
          return j.data;
        });
      });
    },

    // ⭐ 그룹 종합 — 통계 페이지용 (학생의 모든 회차 점수 → 각 회차 그룹 평균 매칭)
    getGroupOverview: function(payload) {
      return callDirectoryPost('getGroupOverview', payload).then(function(j) {
        if (!j.ok) throw new Error(j.message || j.error || '그룹 종합 조회 실패');
        return j.data;
      });
    },
    getFrequentTestQuestions: function(subject, round) {
      // 정답/해설은 응답에 포함되지 않음 (서버에서 제외)
      return callDirectoryGet({ action: 'getQuestions', subject: subject, round: round }).then(function(j) {
        if (!j.ok) throw new Error(j.message || j.error || '문제 조회 실패');
        return j.data;
      });
    },
    getFrequentTestQuestionsByIds: function(subject, round, numbers) {
      // 오답복습용 — 특정 번호들만
      return callDirectoryPost('getQuestionsByIds', {
        subject: subject, round: round, numbers: numbers
      }).then(function(j) {
        if (!j.ok) throw new Error(j.message || j.error || '문제 조회 실패');
        return j.data;
      });
    },
    checkFrequentTestAnswers: function(subject, round, answers) {
      // 채점 — 학생답 { "1": "3", "2": "__unknown__", ... } 보내고 결과 받음
      return callDirectoryPost('checkAnswers', {
        subject: subject, round: round, answers: answers
      }).then(function(j) {
        if (!j.ok) throw new Error(j.message || j.error || '채점 실패');
        return j.result;
      });
    },

    // ── 학생 시트 호출 (callGet/callPost — 토큰 기반) ──
    getFrequentTestProgress: function() {
      // 과목별 마지막 푼 회차 + 시도수 — 10분 캐시 (풀이 저장 시 invalidate)
      return cachedGet('ft_progress', 10 * 60 * 1000, function() {
        return unwrap(callGet('getFrequentTestProgress')).then(function(j) { return j.data; });
      });
    },
    getFrequentTestLogs: function(options) {
      // 풀이기록 — 10분 캐시. options에 따라 키 분기 (limit/필터 다른 경우 별도 캐시)
      var opts = options || {};
      var keyParts = ['ft_logs'];
      if (opts.subject) keyParts.push(opts.subject);
      if (opts.mode) keyParts.push(opts.mode);
      if (opts.limit) keyParts.push('l' + opts.limit);
      return cachedGet(keyParts.join('_'), 10 * 60 * 1000, function() {
        return unwrap(callGet('getFrequentTestLogs', opts)).then(function(j) { return j.data; });
      });
    },
    saveFrequentTestLog: function(payload) {
      // 채점 결과 + 학생답 저장 — 저장 후 빈출 캐시 무효화
      // ⭐ 토큰 자동 첨부 (디렉터리 그룹 점수 기록용 — 백엔드가 mode='전체' 첫 응시만 호출)
      var enriched = Object.assign({}, payload || {}, { token: getTokenFromUrl() });
      return unwrap(callPost('saveFrequentTestLog', enriched)).then(function(j) {
        invalidateCache('ft_');  // 빈출 전체 캐시 무효화 (다음 진입 시 새 데이터)
        return j.result;
      });
    },
    getFrequentTestNoteData: function() {
      // 오답노트 + 통계 — 10분 캐시 (풀이/제거 시 invalidate)
      return cachedGet('ft_note_data', 10 * 60 * 1000, function() {
        return unwrap(callGet('getFrequentTestNoteData')).then(function(j) { return j.data; });
      });
    },
    dismissWrongQuestion: function(payload) {
      // 오답노트 마스터 처리 (제거) — 처리 후 오답노트 캐시 무효화
      return unwrap(callPost('dismissWrongQuestion', payload)).then(function(j) {
        invalidateCache('ft_note');  // 오답노트만 무효 (진행도는 영향 X)
        return j.result;
      });
    },

    // ⭐ NEW: 목표 페이지 — 체크 데이터
    getDailyGoalChecks: function(date) {
      // 특정 날짜 체크된 파트 목록 { 헌법: [...], 형사법: [...], 경찰학: [...] }
      // date 없으면 오늘
      var params = date ? { date: date } : {};
      return unwrap(callGet('getDailyGoalChecks', params)).then(function(j) { return j.data; });
    },
    toggleGoalCheck: function(payload) {
      // payload: { subject, part, checked }
      return unwrap(callPost('toggleGoalCheck', payload)).then(function(j) { return j.result; });
    },
    bulkUpdateGoalChecks: function(payload) {
      // payload: { changes: [{subject, part, checked}, ...] } - 디바운스 큐 일괄 처리
      return unwrap(callPost('bulkUpdateGoalChecks', payload)).then(function(j) { return j.result; });
    },

    // ⭐ 캐시 무효화 — 외부에서 명시적 호출 가능 (예: 풀이 결과 저장 후)
    invalidateCache: function(prefix) {
      invalidateCache(prefix);
    }
  };

  // ───────────────────────────── 중앙 디렉터리 API 호출 헬퍼 ─────────────────────────────
  //   디렉터리 Web App은 토큰 매핑 외에 빈출 테스트도 라우팅. action 파라미터로 구분.

  function callDirectoryGet(params) {
    var dirUrl = getDirectoryUrl();
    if (!dirUrl) {
      return Promise.reject(new Error('DIRECTORY_URL_MISSING: config.js에 DIRECTORY_API_URL이 설정되지 않았어요.'));
    }
    var qs = Object.keys(params).map(function(k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    var url = dirUrl + (dirUrl.indexOf('?') >= 0 ? '&' : '?') + qs;
    return fetchJson(url, { method: 'GET' });
  }

  function callDirectoryPost(action, payload) {
    var dirUrl = getDirectoryUrl();
    if (!dirUrl) {
      return Promise.reject(new Error('DIRECTORY_URL_MISSING: config.js에 DIRECTORY_API_URL이 설정되지 않았어요.'));
    }
    var body = JSON.stringify({ action: action, payload: payload || {} });
    return fetchJson(dirUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body
    });
  }
})();
