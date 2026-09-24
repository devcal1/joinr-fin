import { PageHeader } from '@joinr/ui';
import type { JSX } from 'react';
import { BrandSection } from './BrandSection';
import { ChartsSection } from './ChartsSection';
import { CoreSection } from './CoreSection';

const SECTIONS = [
  { id: 'core', label: 'Core' },
  { id: 'brand', label: 'Brand' },
  { id: 'charts', label: 'Charts' },
] as const;

export function StyleguidePage(): JSX.Element {
  return (
    <div className="jf-app-styleguide">
      <PageHeader title="Style guide" subtitle="Design system" />
      <nav className="jf-app-styleguide__toc" aria-label="Style guide sections">
        {SECTIONS.map((section) => (
          <a key={section.id} href={`#${section.id}`} className="jf-app-styleguide__toc-link">
            {section.label}
          </a>
        ))}
      </nav>
      <CoreSection />
      <BrandSection />
      <ChartsSection />
    </div>
  );
}
