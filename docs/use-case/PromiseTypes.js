"use strict";
function EventWithPromise(target, type, desc, timeLimit) {
  return new Promise((resolve, reject) => {
    target.addEventListener(
      type,
      () => {
        dump(`${type} fired: ${desc}\n`);
        resolve(`${type} fired: ${desc}`);
      },
      {
        capture: true,
        once: true,
        passive: true,
      }
    );

    setTimeout(() => reject(`time expired: ${desc}`), timeLimit);
  });
}

function IFrameLoadPromise(iframe, url, timeLimit = 5000) {
  const p = new Promise(function (resolve, reject) {
    iframe.addEventListener(
      "load", () => resolve(iframe.contentDocument), {once: true, capture: true}
    );
    setTimeout(() => reject(`time expired: ${url}`), timeLimit);
  });
  iframe.setAttribute("src", url);
  return p;
}

function ScriptLoadPromise(src) {
  let scriptElem = document.createElement("script");

  if (document instanceof HTMLDocument) {
    scriptElem = document.createElement("script");
    scriptElem.src = src;
  }
  else {
    scriptElem = document.createElementNS(document.documentElement.namespaceURI, "script");
    scriptElem.setAttribute("href", src);
  }


  let p = new Promise((resolve, reject) => {
    scriptElem.addEventListener("load", resolve, true);
    scriptElem.addEventListener("error", reject, true);
    setTimeout(() => reject(`timeout loading ${src}`), 5000);
  });

  const parentNode = (document instanceof HTMLDocument) ? 
                     document.head :
                     document.documentElement;
  parentNode.appendChild(scriptElem);
  p = p.then(() => scriptElem);
  return p;
}

function PendingPromise() {
  const rv = {};
  rv.promise = new Promise((resolve, reject) => {
    rv.resolve = resolve;
    rv.reject  = reject;
  });
  return rv;
}
