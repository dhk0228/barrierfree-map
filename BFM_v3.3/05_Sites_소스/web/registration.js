/* Registration preview owns its DOM and listeners for its entire lifetime.
 * Leaflet may reattach this element many times. Never bind handlers to a transient
 * popup's string-generated HTML, which is replaced when the popup opens again.
 */
(function (root) {
  function createRegistrationPreview({ document, onConfirm, onCancel }) {
    const content = document.createElement('div');
    content.className = 'registration-preview';
    const heading = document.createElement('strong');
    heading.textContent = '이 위치에 장소를 기록할까요?';
    const help = document.createElement('p');
    help.textContent = '선택한 위치에 장소 이름과 접근성 정보를 추가합니다.';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'button button-primary';
    confirm.textContent = '이 위치에 등록';
    confirm.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      onConfirm();
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'button button-quiet';
    cancel.textContent = '위치 선택 취소';
    cancel.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    });
    content.append(heading, help, confirm, cancel);
    return content;
  }

  // A synchronous gate prevents repeated Enter/click submission while awaiting HTTP.
  function createSubmissionGate() {
    let pending = false;
    return {
      get pending() { return pending; },
      async run(action) {
        if (pending) return false;
        pending = true;
        try { await action(); return true; }
        finally { pending = false; }
      },
    };
  }
  const api = { createRegistrationPreview, createSubmissionGate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BFMRegistration = api;
})(typeof window === 'undefined' ? {} : window);
