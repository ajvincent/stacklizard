const B = new A();

window.addEventListener("load", function() {
  document.getElementById("B.d").addEventListener(
    "click", () => output.value = B.d(), true
  );
}, true);
