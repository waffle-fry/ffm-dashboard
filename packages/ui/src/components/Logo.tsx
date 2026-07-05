// Logo — the FansFund ("FFM") brand wordmark for the dashboard header.
//
// This renders the real brand asset directly: an <img> pointing at
// `/ffm-logo.png`, which is served from the UI's `public/` directory (Vite
// copies `packages/ui/public/*` into the build, and Nginx serves it at the
// site root). Drop the official logo file at `packages/ui/public/ffm-logo.png`
// and it appears here at any height with the correct aspect ratio.
//
// If the asset is missing (404), we fall back to a simple bold "FFM" wordmark so
// the header never shows a broken-image icon.

import { useState } from 'react';

/** Path (site root) the logo image is served from. See packages/ui/public. */
export const LOGO_SRC = '/ffm-logo.png';

export interface LogoProps {
    /** Rendered height in px (width scales to preserve aspect ratio). Default 40. */
    height?: number;
    /** Extra classes for the element. */
    className?: string;
}

export default function Logo({ height = 40, className = '' }: LogoProps): JSX.Element {
    const [failed, setFailed] = useState(false);

    if (failed) {
        // Minimal, clean fallback wordmark when the image asset is unavailable.
        return (
            <span
                aria-label="Fans Fund Me"
                role="img"
                className={`font-heading font-black tracking-tight text-text-primary ${className}`}
                style={{ fontSize: Math.round(height * 0.7), lineHeight: 1 }}
            >
                FFM
            </span>
        );
    }

    return (
        <img
            src={LOGO_SRC}
            alt="Fans Fund Me"
            style={{ height, width: 'auto' }}
            className={className}
            onError={() => setFailed(true)}
        />
    );
}
