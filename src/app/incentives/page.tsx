import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DemoBadge } from '@/components/demo-badge';
import { isDemoMode } from '@/lib/demo-mode';

const DEMO_TIERS = [
  { title: 'Light Traffic', copy: 'Earn a $1 e-gift card for riding the bus during light traffic times.' },
  { title: 'Normal Traffic', copy: 'Earn a $2 e-gift card for riding the bus during normal traffic times.' },
  { title: 'Heavy Traffic', copy: 'Earn a $4 e-gift card for riding the bus during heavy traffic times.' },
];

/**
 * D-25: no approved, funded, redeemable reward inventory exists, so live mode offers no reward. The example tiers
 * render only in demo mode (NEXT_PUBLIC_DEMO_MODE=true), badged as demo data (D-17).
 */
const IncentivesPage = () => {
  const demo = isDemoMode();
  return (
    <>
      <h2 className="text-3xl md:text-5xl font-bold w-full bg-secondary p-6 text-center">
        Tryp Incentives Program{demo && <DemoBadge />}
      </h2>
      <div className="flex flex-col items-center p-6 text-secondary-foreground text-center w-full">
        <div className="w-full max-w-2xl space-y-4 pb-16">
          {demo ? (
            <>
              <p className="text-lg mb-8">
                Demo only: these example tiers show how a rewards program could work. No reward is funded or redeemable.
              </p>
              {DEMO_TIERS.map((tier) => (
                <Card key={tier.title} className="bg-primary-foreground shadow-2xl rounded-lg overflow-hidden">
                  <CardHeader className="bg-primary p-4">
                    <CardTitle className="text-secondary text-xl font-semibold">{tier.title}<DemoBadge /></CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 bg-primary-foreground text-center">
                    <p className="text-lg text-secondary-foreground font-medium">{tier.copy}</p>
                  </CardContent>
                </Card>
              ))}
            </>
          ) : (
            <Card role="status" className="bg-primary-foreground shadow-2xl rounded-lg overflow-hidden">
              <CardContent className="p-6 bg-primary-foreground text-center">
                <p className="text-lg text-secondary-foreground font-medium">
                  No rewards are offered right now. Rewards will appear here only once a funded program exists.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
};

export default IncentivesPage;
