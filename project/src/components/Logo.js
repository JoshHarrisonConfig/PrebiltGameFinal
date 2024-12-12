export function renderLogo(includeSubtitle = true) {
  return `
    <div class="logo-container">
      <img src="/prebilt-logo.png" alt="PreBilt Logo" class="prebilt-logo">
      <h1 class="logo-text">PreBilt</h1>
      ${includeSubtitle ? '<p class="logo-subtitle">SAP Supply Chain Mobility</p>' : ''}
    </div>
  `;
}