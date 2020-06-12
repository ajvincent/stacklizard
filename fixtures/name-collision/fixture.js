function a() {
  return false;
}

(function() {
  function a() {
    return b();
  }
  function b() {
    return 1;
  }
})();
