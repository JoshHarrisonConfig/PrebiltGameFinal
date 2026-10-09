// The brand block. The picture is decorative (the name is right next to it as text), so it
// has an empty alt and screen readers do not say "PreBilt" twice.
//
//   renderLogo()                        large, centred hero (login screen)
//   renderLogo({ compact: true })       small logo + name in a row (leaderboard header)
export function renderLogo({ compact = false, subtitle = true } = {}) {
  if (compact) {
    return `
      <div class="logo-container logo-container--compact">
        <img src="/prebilt-logo.png" alt="" class="prebilt-logo" width="48" height="48">
        <div class="logo-words">
          <span class="logo-text">PreBilt</span>
          ${subtitle ? '<span class="logo-subtitle">SAP Supply Chain Mobility</span>' : ''}
        </div>
      </div>
    `;
  }

  return `
    <div class="logo-container">
      <img src="/prebilt-logo.png" alt="" class="prebilt-logo" width="128" height="128">
      <h1 class="logo-text">PreBilt</h1>
      ${subtitle ? '<p class="logo-subtitle">SAP Supply Chain Mobility</p>' : ''}
    </div>
  `;
}
