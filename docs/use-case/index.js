"use strict";

async function refreshB() {
  const blob = new Blob([document.getElementById("textarea").value]);
  const blobUrl = URL.createObjectURL(blob);
  const params = new URLSearchParams({
    aBlob: blobUrl
  });

  await IFrameLoadPromise(
    document.getElementById("iframe"),
    "b/b.html?" + params.toString()
  );
}

window.addEventListener("load", async function() {
  const contents = await fetch("a/a.js").then(resp => resp.text());
  document.getElementById("textarea").value = contents;
  await refreshB();
}, {once: true});

window.nextPromiseSequence = [
  (val) => val.replace("e: function", "e: async function"),
  (val) => val.replace("e = this.e", "e = await this.e"),
  (val) => val.replace("d: function", "d: async function"),
  (val) => val.replace("this.d", "await this.d"),
  (val) => val.replace("function A", "async function A"),
].map(callback => {
  let rv = PendingPromise();
  rv.promise = rv.promise.then(() => {
    const textarea = document.getElementById("textarea");
    textarea.value = callback(textarea.value);
    return refreshB();
  });
  return rv;
});

async function doNextPromise() {
  let next = nextPromiseSequence.shift();
  next.resolve();
  await next.promise;
  if (nextPromiseSequence.length === 0) {
    document.getElementById("next").disabled = true;
  }
}
