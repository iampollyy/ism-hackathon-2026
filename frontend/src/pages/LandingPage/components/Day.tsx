// Sections 6 to 9, in daylight: the rules, pricing, banks and questions.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, CircleCheck, Hand, KeyRound, Lock, LockKeyhole, PhoneCall, UserCheck } from 'lucide-react';
import { banks, dataProtection, faq, pricing, rules, SIGNUP } from '../copy';
import { FALLBACK_PRICING, getPricing, type Pricing as PricingData } from '../api';
import { afterLoadIdle } from '../capability';
import { BankForm } from './Forms';
import { StaticWave } from './screens';

const ICON = { strokeWidth: 1.75 } as const;
const RULE_ICONS = { user: UserCheck, phone: PhoneCall, hand: Hand, key: KeyRound, lock: Lock, check: CircleCheck } as const;

export function Dawn() {
  return (
    <div className="lp-dawn" aria-hidden="true" data-theme="dark">
      <span className="lp-dawn__sun" />
    </div>
  );
}

export function Rules() {
  return (
    <section id="rules" className="lp-sec lp-rules" aria-labelledby="rules-h" data-theme="light">
      <div className="lp-wrap lp-day">
        <div className="lp-day__copy">
          <h2 id="rules-h" className="lp-h2">
            {rules.h2}
          </h2>
          <p className="lp-lead">{rules.lead}</p>
          <figure className="lp-consent" aria-label={rules.consentLabel}>
            <p className="lp-consent__who">{rules.consentAsker}:</p>
            <p className="lp-consent__quote">{rules.consentSentence}</p>
            <div className="lp-consent__answer">
              <p>
                <span className="lp-consent__who">{rules.consentWho}:</span>{' '}
                <span className="lp-consent__yes">{rules.consentAnswer}</span>
              </p>
              <StaticWave lit={1} bars={18} className="lp-wave--consent" />
            </div>
            <figcaption className="lp-consent__done">
              <Check size={18} {...ICON} aria-hidden="true" />
              <span className="lp-tnum">{rules.consentDone}</span>
            </figcaption>
          </figure>
        </div>
        <ul className="lp-rules__list">
          {rules.items.map((r) => {
            const Icon = RULE_ICONS[r.icon as keyof typeof RULE_ICONS];
            return (
              <li key={r.title}>
                <Icon size={24} {...ICON} aria-hidden="true" className="lp-rules__icon" />
                <div>
                  <h3 className="lp-h4">{r.title}</h3>
                  <p>{r.text}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

export function usePricing(): PricingData {
  const [data, setData] = useState<PricingData>(FALLBACK_PRICING);
  useEffect(() => {
    const ctrl = new AbortController();
    const cancel = afterLoadIdle(() => {
      getPricing(ctrl.signal)
        .then(setData)
        .catch(() => undefined);
    });
    return () => {
      cancel();
      ctrl.abort();
    };
  }, []);
  return data;
}

export function PricingSection({ data, headingLevel = 2, onHome = true }: { data: PricingData; headingLevel?: 1 | 2; onHome?: boolean }) {
  const cards = data.plans.filter((p) => p.choosable);
  const partner = data.plans.find((p) => p.key === 'partner');
  const H = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <section id="pricing" className="lp-sec lp-pricing" aria-labelledby="pricing-h" data-theme="light">
      <div className="lp-wrap">
        <div className="lp-pricing__head">
          <H id="pricing-h" className={headingLevel === 1 ? 'lp-h1 lp-h1--page' : 'lp-h2'}>
            {pricing.h2}
          </H>
          <p className="lp-lead">{pricing.lead(data.trial_days)}</p>
        </div>
        <ul className="lp-plans">
          {cards.map((plan) => (
            <li key={plan.key} className={`lp-plan lp-plan--${plan.key}`}>
              <h3 className="lp-h3">{plan.name}</h3>
              <p className="lp-plan__price lp-tnum">{plan.price}</p>
              <p className="lp-plan__note">{plan.key === 'bank' ? pricing.bankNote : plan.note}</p>
              <ul className="lp-plan__features">
                {plan.features.map((f) => (
                  <li key={f}>
                    <Check size={18} {...ICON} aria-hidden="true" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link to={`${SIGNUP}?plan=${plan.key}`} className="lp-btn lp-btn--dark lp-btn--block">
                {plan.cta}
              </Link>
            </li>
          ))}
        </ul>
        <p className="lp-pricing__demo">{data.demo_note}</p>
        {partner ? (
          <p className="lp-pricing__partner">
            {pricing.partnerRow}{' '}
            {onHome ? (
              <a href="#banks" className="lp-link">
                {pricing.partnerLink}
                <ArrowRight size={16} {...ICON} aria-hidden="true" />
              </a>
            ) : (
              <Link to="/#banks" className="lp-link">
                {pricing.partnerLink}
                <ArrowRight size={16} {...ICON} aria-hidden="true" />
              </Link>
            )}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function Banks() {
  return (
    <section id="banks" className="lp-sec lp-banks" aria-labelledby="banks-h" data-theme="dark">
      <div className="lp-wrap">
        <div className="lp-day lp-banks__top">
          <div className="lp-day__copy">
            <h2 id="banks-h" className="lp-h2">
              {banks.h2}
            </h2>
            <p className="lp-lead">{banks.lead}</p>
            <p className="lp-body">
              {banks.body}
              <sup className="lp-sup">
                <a href="#src-2" aria-label="Source 2: LRT, February 2026">
                  2
                </a>
              </sup>
            </p>
            <ul className="lp-checks">
              {banks.gets.map((g) => (
                <li key={g}>
                  <Check size={20} {...ICON} aria-hidden="true" />
                  {g}
                </li>
              ))}
            </ul>
            <p className="lp-banks__price">{banks.priceLine}</p>
          </div>
          <BankForm />
        </div>

        <div className="lp-banks__pilot">
          <h3 className="lp-h3">{banks.pilot.title}</h3>
          <ol className="lp-steps">
            {banks.pilot.steps.map((step, i) => (
              <li key={step}>
                <span className="lp-steps__n lp-tnum" aria-hidden="true">
                  {i + 1}
                </span>
                <p>{step}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="lp-day lp-banks__more">
          <div className="lp-banks__report">
            <h3 className="lp-h4">{banks.report.title}</h3>
            <ul className="lp-measures">
              {banks.report.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="lp-banks__counts">{banks.report.countsOnly}</p>
            <p className="lp-banks__eval">{banks.evaluation}</p>
          </div>
          <DataProtection />
        </div>
      </div>
    </section>
  );
}

/** What is stored, who processes it and what a bank sees. Linked from the footer (#data). */
function DataProtection() {
  return (
    <section id="data" className="lp-data" aria-labelledby="data-h">
      <h3 id="data-h" className="lp-h4 lp-data__title">
        <LockKeyhole size={20} {...ICON} aria-hidden="true" />
        {dataProtection.title}
      </h3>
      <p className="lp-data__lead">{dataProtection.lead}</p>
      <dl className="lp-data__list">
        {dataProtection.items.map((item) => (
          <div key={item.term}>
            <dt>{item.term}</dt>
            <dd>{item.text}</dd>
          </div>
        ))}
      </dl>
      <p className="lp-data__next">{dataProtection.next}</p>
    </section>
  );
}

export function Faq() {
  return (
    <section id="faq" className="lp-sec lp-faq" aria-labelledby="faq-h" data-theme="light">
      <div className="lp-wrap">
        <h2 id="faq-h" className="lp-h2">
          {faq.h2}
        </h2>
        <dl className="lp-faq__list">
          {faq.items.map((item) => (
            <div key={item.q} className="lp-faq__item">
              <dt>
                <h3 className="lp-faq__q">{item.q}</h3>
              </dt>
              <dd>{item.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
