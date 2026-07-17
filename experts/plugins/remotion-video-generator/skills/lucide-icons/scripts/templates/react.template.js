/**
 * React component template for Lucide icons
 * This template generates TypeScript React components from SVG icons
 */

/**
 * Convert kebab-case to PascalCase
 * @param {string} str - The kebab-case string
 * @returns {string} PascalCase string
 */
export function toPascalCase(str) {
  return str
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * Extract SVG attributes from the svg tag
 * @param {string} svgContent - Full SVG content
 * @returns {object} Object containing viewBox and other attributes
 */
export function extractSvgAttributes(svgContent) {
  // Remove XML declaration if present
  let content = svgContent.replace(/<\?xml[^>]*\?>/g, '').trim();
  
  // Extract attributes from <svg> tag
  const svgMatch = content.match(/<svg([^>]*)>/i);
  if (!svgMatch) return { viewBox: '0 0 24 24' };
  
  const attrs = svgMatch[1];
  const viewBoxMatch = attrs.match(/viewBox="([^"]*)"/i);
  const widthMatch = attrs.match(/width="([^"]*)"/i);
  const heightMatch = attrs.match(/height="([^"]*)"/i);
  
  return {
    viewBox: viewBoxMatch ? viewBoxMatch[1] : '0 0 24 24',
    width: widthMatch ? widthMatch[1] : null,
    height: heightMatch ? heightMatch[1] : null
  };
}

/**
 * Extract SVG inner content (paths, circles, etc.)
 * @param {string} svgContent - Full SVG content
 * @returns {string} Inner SVG elements
 */
export function extractSvgInner(svgContent) {
  // Remove XML declaration if present
  let content = svgContent.replace(/<\?xml[^>]*\?>/g, '').trim();
  
  // Extract content between <svg> tags
  const match = content.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  return '';
}

/**
 * Convert SVG attributes to React/JSX format
 * @param {string} svgInner - SVG inner content
 * @returns {string} JSX-compatible content
 */
export function convertToJsx(svgInner) {
  return svgInner
    // Convert stroke-* attributes to camelCase
    .replace(/stroke-width/g, 'strokeWidth')
    .replace(/stroke-linecap/g, 'strokeLinecap')
    .replace(/stroke-linejoin/g, 'strokeLinejoin')
    .replace(/stroke-dasharray/g, 'strokeDasharray')
    .replace(/stroke-dashoffset/g, 'strokeDashoffset')
    .replace(/stroke-miterlimit/g, 'strokeMiterlimit')
    .replace(/stroke-opacity/g, 'strokeOpacity')
    // Convert fill-* attributes
    .replace(/fill-rule/g, 'fillRule')
    .replace(/fill-opacity/g, 'fillOpacity')
    // Convert other common attributes
    .replace(/clip-path/g, 'clipPath')
    .replace(/clip-rule/g, 'clipRule')
    .replace(/font-family/g, 'fontFamily')
    .replace(/font-size/g, 'fontSize')
    .replace(/font-weight/g, 'fontWeight')
    .replace(/text-anchor/g, 'textAnchor')
    .replace(/dominant-baseline/g, 'dominantBaseline')
    // Replace stroke="currentColor" with {color}
    .replace(/stroke="currentColor"/g, 'stroke={color}')
    // Replace fill="none" (keep as is for Lucide icons)
    // Replace strokeWidth="2" with {strokeWidth}
    .replace(/strokeWidth="[^"]*"/g, 'strokeWidth={strokeWidth}');
}

/**
 * Generate a React TypeScript component from SVG content
 * @param {string} iconName - The icon name (kebab-case)
 * @param {string} svgContent - The full SVG content
 * @returns {string} TypeScript React component code
 */
export function generateReactComponent(iconName, svgContent) {
  const componentName = toPascalCase(iconName) + 'Icon';
  const svgInner = extractSvgInner(svgContent);
  const jsxContent = convertToJsx(svgInner);
  const svgAttrs = extractSvgAttributes(svgContent);

  return `import React from 'react';

export interface ${componentName}Props {
  /** Icon size in pixels */
  size?: number | string;
  /** Icon color */
  color?: string;
  /** Stroke width */
  strokeWidth?: number | string;
  /** Additional CSS classes */
  className?: string;
  /** Additional inline styles */
  style?: React.CSSProperties;
  /** Accessibility label */
  'aria-label'?: string;
  /** onClick handler */
  onClick?: React.MouseEventHandler<SVGSVGElement>;
}

/**
 * ${componentName} - Lucide icon component
 * @see https://lucide.dev/icons/${iconName}
 */
export const ${componentName}: React.FC<${componentName}Props> = ({
  size = 24,
  color = 'currentColor',
  strokeWidth = 2,
  className,
  style,
  'aria-label': ariaLabel,
  onClick,
  ...props
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="${svgAttrs.viewBox}"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-label={ariaLabel}
      onClick={onClick}
      role={ariaLabel ? 'img' : undefined}
      aria-hidden={!ariaLabel}
      {...props}
    >
      ${jsxContent}
    </svg>
  );
};

${componentName}.displayName = '${componentName}';

export default ${componentName};
`;
}

/**
 * Generate a simpler React component (without TypeScript)
 * @param {string} iconName - The icon name (kebab-case)
 * @param {string} svgContent - The full SVG content
 * @returns {string} JavaScript React component code
 */
export function generateReactComponentJS(iconName, svgContent) {
  const componentName = toPascalCase(iconName) + 'Icon';
  const svgInner = extractSvgInner(svgContent);
  const jsxContent = convertToJsx(svgInner);
  const svgAttrs = extractSvgAttributes(svgContent);

  return `import React from 'react';

/**
 * ${componentName} - Lucide icon component
 * @see https://lucide.dev/icons/${iconName}
 */
export const ${componentName} = ({
  size = 24,
  color = 'currentColor',
  strokeWidth = 2,
  className,
  style,
  ...props
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="${svgAttrs.viewBox}"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      {...props}
    >
      ${jsxContent}
    </svg>
  );
};

${componentName}.displayName = '${componentName}';

export default ${componentName};
`;
}
