// Logo — the FansFund ("FFM") brand wordmark for the dashboard header.
//
// This is a self-contained inline SVG recreation of the supplied FFM logo:
// three bold letters "F F M" with the vertical descriptors FANS / FUND / ME
// running up each column, exactly as in the brand mark. It is rendered in
// `currentColor` (white on the dark header) with a transparent background so it
// sits natively on the dark chrome — the source mark is white-on-black, and the
// header already provides the dark backdrop.
//
// It scales crisply at any size. To use the official raster/vector asset
// instead, drop it into the UI (e.g. packages/ui/src/assets/) and swap the SVG
// below for an <img>/import — nothing else needs to change.

export interface LogoProps {
    /** Rendered height in px (width scales to preserve aspect ratio). Default 36. */
    height?: number;
    /** Extra classes for the SVG element. */
    className?: string;
}

/**
 * The FFM wordmark. Decorative composition, labelled for assistive tech via
 * `role="img"` + `aria-label`.
 */
export default function Logo({ height = 36, className = '' }: LogoProps): JSX.Element {
    // viewBox is ~2.67:1 (three equal columns) to match the source proportions.
    const width = Math.round((height * 320) / 120);
    return (
        <svg
            role="img"
            aria-label="Fans Fund Me"
            width={width}
            height={height}
            viewBox="0 0 320 120"
            className={className}
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
        >
            {/* Big letters: F F M */}
            <g
                fontFamily="Outfit, 'Work Sans', system-ui, sans-serif"
                fontWeight={800}
            >
                <text x="4" y="90" fontSize="104">
                    F
                </text>
                <text x="110" y="90" fontSize="104">
                    F
                </text>
                <text x="212" y="90" fontSize="104">
                    M
                </text>
            </g>

            {/* Vertical descriptors running bottom-to-top up each column. */}
            <g
                fontFamily="Outfit, 'Work Sans', system-ui, sans-serif"
                fontWeight={700}
                fontSize="19"
                letterSpacing="1.5"
            >
                <text transform="translate(30 114) rotate(-90)">FANS</text>
                <text transform="translate(136 114) rotate(-90)">FUND</text>
                <text transform="translate(238 114) rotate(-90)">ME</text>
            </g>
        </svg>
    );
}
