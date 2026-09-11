import { useEffect, useState } from 'react';
import logoUrl from '../../assets/logo.svg';
import { t } from '../../lib/i18n';

const STEPS = ['splash.boot.init', 'splash.boot.services', 'splash.boot.ready'];

/** 启动画面：Logo 弹簧入场 + 扫描环 + 字标聚焦 + 阶段进度；exiting 时淡出收场 */
export default function Splash({ exiting }: { exiting: boolean }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 640);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className={'splash' + (exiting ? ' splash-exit' : '')}>
      <div className="splash-orb splash-orb1" />
      <div className="splash-orb splash-orb2" />
      <div className="splash-center">
        <div className="splash-logo">
          <img src={logoUrl} alt="" draggable={false} />
          <span className="splash-ring" />
        </div>
        <div className="splash-word">MR·SLIY</div>
        <div className="splash-tag">{t('splash.tagline')}</div>
      </div>
      <div className="splash-bottom">
        <div className="splash-bar"><span /></div>
        <div className="splash-step">{t(STEPS[step])}</div>
      </div>
    </div>
  );
}
