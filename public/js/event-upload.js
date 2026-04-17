(function (root, factory) {
  root.GngEventUpload = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function initEventUploadPanel(options) {
    var settings = options || {};
    var form = document.getElementById('event-upload-form');
    if (!form) return;

    var fileInput = document.getElementById('event-file-input');
    var status = document.getElementById('event-upload-status');
    var submitBtn = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      if (!fileInput.files || fileInput.files.length === 0) {
        status.textContent = '请先选择 Event.xlsx 文件';
        status.className = 'upload-status error';
        return;
      }

      var file = fileInput.files[0];
      if (!/\.xlsx$/i.test(file.name)) {
        status.textContent = '仅支持上传 .xlsx 文件';
        status.className = 'upload-status error';
        return;
      }

      var formData = new FormData();
      formData.append('eventFile', file);
      submitBtn.disabled = true;
      status.textContent = '上传中，请稍候...';
      status.className = 'upload-status';

      fetch('/api/event-upload', { method: 'POST', body: formData })
        .then(function (response) {
          return response.json().then(function (json) {
            if (!response.ok) throw new Error(json.error || '上传失败');
            return json;
          });
        })
        .then(function (json) {
          status.textContent = (json.message || '上传成功') + '（活动数：' + (json.activities || 0) + '）';
          status.className = 'upload-status success';
          form.reset();
          if (typeof settings.onSuccess === 'function') settings.onSuccess(json);
        })
        .catch(function (error) {
          status.textContent = error.message || '上传失败';
          status.className = 'upload-status error';
          if (typeof settings.onError === 'function') settings.onError(error);
        })
        .finally(function () {
          submitBtn.disabled = false;
        });
    });
  }

  return {
    initEventUploadPanel: initEventUploadPanel,
  };
});
