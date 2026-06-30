/**
 * Police Maker - 설정 파일
 *
 * Netlify 배포 전에 DIRECTORY_API_URL을 디렉터리 시트의 Web App URL로 교체.
 * 학생 시트 URL은 디렉터리 API에서 토큰으로 받아오므로 여기에 적지 않음.
 *
 * 이 파일을 안 만들거나 URL을 ''로 두면, 로컬 테스트 시 #devUrl 입력칸이 자동 노출됨.
 */
window.POLICEMAKER_CONFIG = {
  // ⚠️ 실제 디렉터리 Web App URL로 교체
  // 예) 'https://script.google.com/macros/s/AKfy.../exec'
  DIRECTORY_API_URL: 'https://script.google.com/macros/s/AKfycbxpD8Id7eLdFeLfoSIUhnFNpRjzQnuETl3EKX674AXJsL7q5XGVU5A-Qp-RbhZEqYUQhA/exec',

  // 학생 URL을 localStorage에 캐시할 시간 (밀리초). 0이면 캐싱 안 함.
  // 너무 길면 URL 변경 시 반영 늦음, 너무 짧으면 매번 디렉터리 호출
  URL_CACHE_TTL_MS: 1000 * 60 * 60 * 24,   // 24시간

  // 학생 데이터 호출 타임아웃 (밀리초)
  REQUEST_TIMEOUT_MS: 30 * 1000,            // 30초

  // ⭐ 캐시 버전 — 코드 deploy 시 이 값 +1 하면 localStorage 캐시 자동 무효화.
  //   ?v=N 캐시버스팅과 별개. 캐시 구조 변경 시에만 올리면 됨.
  CACHE_VERSION: 1
};
