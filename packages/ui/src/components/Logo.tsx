// Logo — the FansFund ("FFM") brand wordmark for the dashboard header.
//
// Renders the real brand image. The PNG is imported as a module asset so Vite
// bundles it (with a hashed, cached filename) into the build — this works with
// the existing Docker build, which copies `packages/ui/src` (unlike `public/`,
// which the Dockerfile does not copy).
//
// To replace the logo, drop a new file at `src/assets/ffm-logo.png`.

import { useState } from 'react';
import logoSrc from '../assets/ffm-logo.png';

export interface LogoProps {
    /** Rendered height in px (width scales to preserve aspect ratio). Default 40. */
    height?: number;
    /** Extra classes for the element. */
    className?: string;
}

export default function Logo({ height = 40, className = '' }: LogoProps): JSX.Element {
    const [failed, setFailed] = useState(false);

    if (failed) {
        // Defensive fallback if the image ever fails to load at runtime.
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
            src={logoSrc}
            alt="Fans Fund Me"
            style={{ height, width: 'auto' }}
            className={className}
            onError={() => setFailed(true)}
        />
    );
}
