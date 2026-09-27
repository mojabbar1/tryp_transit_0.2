'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useTravelContext } from '@/contexts/travel-context';
import { formatCostDifference } from '@/lib/format';
import { shouldLeaveRoutesPage, visibleIncentive } from '@/lib/trip-view';
import { isNil } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const RoutesPage = () => {
  const trip = useTravelContext();
  const { hasTrip, costSavings, trafficDensity, travelTime, isDemo } = trip;
  const router = useRouter();
  const costText = formatCostDifference(costSavings);
  const incentive = visibleIncentive(trip);

  useEffect(() => {
    // Leave only when no trip was loaded. A successful trip can have every measurement unavailable
    // (transit time before GTFS, D-21; cost or traffic without TomTom), and it still renders.
    if (shouldLeaveRoutesPage({ hasTrip })) {
      router.push('/dashboard');
    }
  }, [hasTrip, router]);

  const getCurrentTime = () => new Date();

  const calculateArrivalTime = () => {
    const now = getCurrentTime();
    const arrivalTime = new Date(now.getTime() + travelTime! * 60000);
    const bufferTime = 10;
    const arrivalAtBusStop = new Date(
      arrivalTime.getTime() - bufferTime * 60000,
    );
    return arrivalAtBusStop.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <>
      {costText && (
        <div className="p-6 bg-secondary text-secondary-foreground text-center">
          <h2 className="text-3xl font-bold">DID YOU KNOW?</h2>
          <p className="mt-2 text-lg">
            Taking the <span className="font-bold">bus</span> versus driving on this trip:{' '}
            <span className="font-bold">{costText}</span> (base fare vs. fuel and maintenance).
          </p>
        </div>
      )}
      <div className="flex flex-col items-center mx-10 mt-10 lg:mx-24">
        <h1 className="text-primary font-bold text-4xl mb-8">MY REWARDS</h1>
        <Card className="w-full max-w-2xl bg-primary-foreground rounded-lg overflow-hidden mb-8 shadow-2xl">
          <CardHeader className="bg-primary p-6">
            <CardTitle className="text-primary-foreground text-2xl font-semibold">
              My Tryp
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 bg-primary-foreground">
            <div className="grid grid-cols-1 gap-4">
              <div className="flex flex-col items-center bg-primary p-4 rounded-lg shadow-md w-full">
                <p className="text-lg text-white font-medium">
                  {isNil(travelTime) ? (
                    "Bus timing isn't available yet. Check CARTA's schedule."
                  ) : (
                    <>
                      You should arrive at the bus stop by:{' '}
                      <span className="font-bold">{calculateArrivalTime()}</span>
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <div className="flex flex-col items-center bg-secondary p-4 rounded-lg shadow-md">
                <p className="text-lg font-medium text-secondary-foreground">
                  Traffic now
                </p>
                <p className="text-2xl text-primary-foreground font-bold">
                  {trafficDensity ?? 'Unavailable'}
                </p>
              </div>
              <div className="flex flex-col items-center bg-secondary p-4 rounded-lg shadow-md">
                <p className="text-lg font-medium text-secondary-foreground">
                  Travel Time
                </p>
                <p className="text-2xl text-primary-foreground font-bold">
                  {isNil(travelTime) ? 'Unavailable' : `${travelTime} minutes`}
                </p>
              </div>
              {/* Only a reward the response carried with an active offer (D-25) */}
              {incentive && (
                <div className="flex flex-col items-center bg-secondary p-4 rounded-lg shadow-md">
                  <p className="text-lg font-medium text-secondary-foreground">
                    Incentive
                    {isDemo && <span className="ml-1 px-2 py-0.5 bg-purple-200 text-purple-800 text-xs rounded-full">Demo</span>}
                  </p>
                  <p className="text-2xl text-primary-foreground font-bold">{incentive.value}</p>
                  <p className="text-sm text-secondary-foreground text-center">{incentive.description}</p>
                </div>
              )}
            </div>
          </CardContent>
          <CardFooter className="p-4 bg-secondary flex justify-between">
            <a
              href="https://www.ridecarta.com/fares-passes/"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button className="bg-primary hover:bg-[#3CC168]/80">
                BOOK NOW WITH CARTA
              </Button>
            </a>
            <Link href="/find-rides">
              <Button className="bg-primary hover:bg-[#3CC168]/80">
                PLAN ANOTHER ROUTE
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    </>
  );
};

export default RoutesPage;
