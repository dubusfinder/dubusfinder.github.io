
/* =========================================
   PWA INSTALLATION
   Detect Installed + Show Install Button
========================================= */

const installButton = $("installBtn");

function isAppInstalled() {
  const standaloneMode =
    window.matchMedia &&
    window.matchMedia("(display-mode: standalone)").matches;

  const fullscreenMode =
    window.matchMedia &&
    window.matchMedia("(display-mode: fullscreen)").matches;

  const iosStandalone =
    window.navigator.standalone === true;

  return standaloneMode || fullscreenMode || iosStandalone;
}

function hideInstallButton() {
  if (installButton) {
    installButton.hidden = true;
  }
}

function showInstallButton() {
  if (installButton && !isAppInstalled()) {
    installButton.hidden = false;
  }
}

// Initially hide until installation availability is confirmed
hideInstallButton();

let isIOSInstall = false;

// Check if already installed
if (isAppInstalled()) {
  hideInstallButton();
}

// Listen for browser installation support
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();

  if (isAppInstalled()) {
    hideInstallButton();
    return;
  }

  deferredPrompt = event;
  isIOSInstall = false;

  showInstallButton();
});

// iOS Safari does not support beforeinstallprompt
const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const isSafari =
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

if (isIOS && isSafari && !isAppInstalled()) {
  isIOSInstall = true;
  showInstallButton();
}

// Install button click
installButton?.addEventListener("click", async () => {

  if (isAppInstalled()) {
    hideInstallButton();
    return;
  }

  // iPhone / iPad manual installation instructions
  if (isIOSInstall) {
    alert(
      'To install DU BUS FINDER:\n\n' +
      '1. Tap the Share button in Safari.\n' +
      '2. Select "Add to Home Screen".\n' +
      '3. Tap "Add".'
    );

    return;
  }

  if (!deferredPrompt) return;

  try {
    await deferredPrompt.prompt();

    const choice = await deferredPrompt.userChoice;

    deferredPrompt = null;

    if (choice?.outcome === "accepted") {
      hideInstallButton();
    }

  } catch (error) {
    console.error("PWA installation error:", error);
  }
});

// Detect successful installation
window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  hideInstallButton();
});
