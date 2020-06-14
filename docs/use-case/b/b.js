
window.rejectOnError = null;

window.addEventListener("load", async function() {
  const params = new URLSearchParams(window.location.search);
  const scriptURL = params.get("aBlob") || "a/a.js";

  let rejectPromise = PendingPromise();
  window.rejectOnError = rejectPromise.reject;
  rejectPromise.promise.catch(exn => output.value = exn);

  let loadPromise = ScriptLoadPromise(scriptURL);
  loadPromise = loadPromise.then(
    () => {
      output.value = "B.d() = " + B.d();
      rejectPromise.resolve();
    }
  );
  loadPromise = loadPromise.catch(exn => rejectPromise.reject(exn.message));

  try {
    await Promise.all([rejectPromise.promise, loadPromise]);
  }
  catch (ex) {
    // do nothing, this is intentional
  }
  window.rejectOnError = null;
}, true);

window.addEventListener("error", (event) => {
  if (typeof window.rejectOnError === "function")
    window.rejectOnError(event.message);
  event.preventDefault();
}, true);
