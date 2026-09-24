import type { JSX, ReactNode } from 'react';

export interface StepCardProps {
  step: number;
  title: string;
  /** Violet-tint sub-line under the title. */
  subtitle?: string;
  children?: ReactNode;
}

/** A numbered step: the violet→fuchsia disc (its only use in the UI), uppercase title, sub-line. */
export function StepCard({ step, title, subtitle, children }: StepCardProps): JSX.Element {
  return (
    <div className="jf-step">
      <span className="jf-step__disc" aria-hidden="true">
        {step}
      </span>
      <div className="jf-step__body">
        <h3 className="jf-step__title">
          <span className="jf-visually-hidden">Step {step}:</span> {title}
        </h3>
        {subtitle ? <p className="jf-step__subtitle">{subtitle}</p> : null}
        {children ? <div className="jf-step__content">{children}</div> : null}
      </div>
    </div>
  );
}
