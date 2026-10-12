/**
 * A short two-tone beep for the stock notice (F12). Browsers only allow sound after the user has touched the page, and
 * some devices have no audio: a failure is silent, the banner is the real notice.
 */
export function playAlertBeep(): void {
  try {
    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Context) return;
    const context = new Context();
    const now = context.currentTime;
    [880, 660].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.15, now + index * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.22 + 0.2);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now + index * 0.22);
      oscillator.stop(now + index * 0.22 + 0.21);
    });
    window.setTimeout(() => void context.close(), 800);
  } catch {
    // no sound, the banner stays
  }
}
