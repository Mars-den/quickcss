const defaults = {
  font: "system-ui",
  size: 18,
  lineHeight: 1.6,
  width: 760,
  spacing: 1,
  headingScale: 1.15,
  headingWeight: 650,
  lightBackground: "#ffffff",
  lightText: "#242424",
  darkBackground: "#1e1e1e",
  darkText: "#dddddd",
  accent: "#9874ee",
  customCss: "",
};
const limits = {
  size: [12, 36],
  lineHeight: [1, 2.5],
  width: [320, 1400],
  spacing: [0.3, 3],
  headingScale: [0.7, 1.8],
  headingWeight: [300, 900],
};
function validate(profile) {
  const validatedProfile = { ...defaults, ...profile };
  for (const [property, [minimum, maximum]] of Object.entries(limits))
    if (
      !Number.isFinite(validatedProfile[property]) ||
      validatedProfile[property] < minimum ||
      validatedProfile[property] > maximum
    )
      throw Error(`${property} must be between ${minimum} and ${maximum}`);
  if (
    !["system-ui", "serif", "monospace", "Georgia", "Helvetica Neue"].includes(
      validatedProfile.font,
    )
  )
    throw Error("Unsupported font");
  for (const property of [
    "lightBackground",
    "lightText",
    "darkBackground",
    "darkText",
    "accent",
  ])
    if (!/^#[0-9a-f]{6}$/i.test(validatedProfile[property]))
      throw Error(`${property} must be a six-digit hex color`);
  if (
    typeof validatedProfile.customCss !== "string" ||
    validatedProfile.customCss.length > 50000 ||
    /quickcss:(begin|end)/i.test(validatedProfile.customCss)
  )
    throw Error("Invalid custom CSS or reserved ownership marker");
  // CSS-only local styling; reject fetch rules even though native CSP also restricts them.
  if (/@import|url\s*\(|<\/style/i.test(validatedProfile.customCss))
    throw Error("Custom CSS cannot import or reference assets");
  return validatedProfile;
}
function css(profile) {
  const validatedProfile = validate(profile);
  const font = ["system-ui", "serif", "monospace"].includes(
    validatedProfile.font,
  )
    ? validatedProfile.font
    : `"${validatedProfile.font}"`;
  return `body {
 --font-text-theme: ${font}; --font-text: ${font}; --font-text-size: ${validatedProfile.size}px; --font-preferred-size: ${validatedProfile.size}px;
 --line-height-normal: ${validatedProfile.lineHeight}; --file-line-width: ${validatedProfile.width}px; --p-spacing: ${validatedProfile.spacing}em; --text-accent: ${validatedProfile.accent}; --interactive-accent: ${validatedProfile.accent};
}
body.theme-light { --background-primary: ${validatedProfile.lightBackground}; --text-normal: ${validatedProfile.lightText}; }
body.theme-dark { --background-primary: ${validatedProfile.darkBackground}; --text-normal: ${validatedProfile.darkText}; }
.markdown-preview-view { font-family: ${font}; font-size: ${validatedProfile.size}px; line-height: ${validatedProfile.lineHeight}; color: var(--text-normal); background: var(--background-primary); }
.markdown-preview-sizer { max-width: ${validatedProfile.width}px !important; margin-inline: auto; }
.markdown-rendered p { margin-block: ${validatedProfile.spacing}em; }
${[1, 2, 3, 4, 5, 6].map((n) => `.markdown-rendered h${n} { font-size: ${([2, 1.6, 1.35, 1.2, 1.1, 1][n - 1] * validatedProfile.headingScale).toFixed(3)}em; font-weight: ${validatedProfile.headingWeight}; }`).join("\n")}
.markdown-rendered a { color: ${validatedProfile.accent}; }
${validatedProfile.customCss}`;
}
module.exports = { defaults, limits, validate, css };
