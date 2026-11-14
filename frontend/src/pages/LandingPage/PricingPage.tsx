// /pricing: the landing page's pricing section on its own, with the questions and
// the close. No 3D and no call here.
import { useRef } from 'react';
import './styles/landing.scss';
import { head } from './copy';
import { useLandingHead, useLandingShell } from './useLandingHead';
import { Nav } from './components/Nav';
import { Faq, PricingSection, usePricing } from './components/Day';
import { Close, Footer } from './components/Close';

export default function PricingPage() {
  useLandingHead({ title: head.pricingTitle, description: head.description, theme: '#edf0ff', route: 'landing-day' });
  const rootRef = useRef<HTMLDivElement>(null);
  const data = usePricing();
  useLandingShell(rootRef);
  return (
    <div className="lp lp--pricing" lang="en-GB" ref={rootRef} data-mode="lite">
      <Nav onHome={false} initialTheme="light" showSound={false} />
      <main id="content" tabIndex={-1}>
        <PricingSection data={data} headingLevel={1} onHome={false} />
        <Faq />
        <Close />
      </main>
      <Footer onHome={false} />
    </div>
  );
}
