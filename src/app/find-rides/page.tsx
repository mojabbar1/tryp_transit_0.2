'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useFormState } from 'react-hook-form';
import { useMemo, useState } from 'react';
import axios from 'axios';
import { z } from 'zod';
import useRequireAuth from '../hooks/useRequireAuth';
import BusPhotoFour from '@/public/bus-four.jpg';
import BusPhotoEight from '@/public/bus-eight.jpg';
import BusPhotoTen from '@/public/bus-ten.jpg';
import BusPhotoTwelve from '@/public/bus-twelve.jpg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRouter } from 'next/navigation';
import { routesFormSchema } from '@/validation/routesFormSchema';
import BackgroundPhoto from '@/components/background-photo';
import { StopCombobox } from '@/components/stop-combobox';
import { useTravelContext } from '@/contexts/travel-context';
import Loading from '@/components/loading';
import { stopRequestFields, type StopOption } from '@/lib/stops/types';
import { stopSourceNote, useStops } from '@/lib/stops/use-stops';
import { tripSummaryFrom } from '@/lib/trip-view';
import type { TransitInsightResponse } from '@/types/interfaces';

const Dashboard = () => {
  const isLoggedIn = useRequireAuth();
  const { setTravelData } = useTravelContext();
  const stops = useStops();
  const optionsByKey = useMemo(() => new Map((stops.data?.stops ?? []).map((option) => [option.key, option])), [stops.data]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const router = useRouter();

  const form = useForm({
    resolver: zodResolver(routesFormSchema),
    defaultValues: {
      departure: '',
      destination: '',
      timeToDestination: '',
    },
  });

  const { errors } = useFormState({ control: form.control });

  async function onSubmit(data: z.infer<typeof routesFormSchema>) {
    const departureOption = optionsByKey.get(data.departure);
    const destinationOption = optionsByKey.get(data.destination);

    if (!departureOption || !destinationOption) {
      setErrorMessage('Please choose both stops from the list.');
      return;
    }
    const departure = stopRequestFields(departureOption);
    const destination = stopRequestFields(destinationOption);

    setErrorMessage(null);
    let succeeded = false;

    try {
      setIsLoading(true);
      const response = await axios.post<TransitInsightResponse>('/api/transit-insights', {
        departure: departure.point,
        destination: destination.point,
        timeToDestination: data.timeToDestination,
        ...(departure.stopId ? { departureStopId: departure.stopId } : {}),
        ...(destination.stopId ? { destinationStopId: destination.stopId } : {}),
      });

      setTravelData(tripSummaryFrom(response.data));
      succeeded = true;
    } catch (error) {
      // axios rejects on any non-2xx status as well as on network errors
      console.error('Transit insights request failed:', error);
      setErrorMessage("We couldn't get your trip insights right now. Please try again.");
    } finally {
      setIsLoading(false);
    }

    if (succeeded) {
      router.push('/routes');
    }
  }

  if (!isLoggedIn) {
    return null;
  }

  if (isLoading) {
    return <Loading />;
  }

  const sourceNote = stopSourceNote(stops.data);
  const options = stops.data?.stops ?? [];
  const pick = (key: string): StopOption | null => optionsByKey.get(key) ?? null;

  return (
    <>
      <div className="p-6 bg-secondary text-secondary-foreground text-center">
        <h2 className="text-3xl font-bold">Welcome to Tryp Transit</h2>
        <div className="flex items-center justify-center">
          <p className="mt-2 text-lg">
            Compare driving with CARTA&apos;s bus for your trip. Pick your stops and arrival time, and we&apos;ll show
            the current traffic, the drive time and cost, and the scheduled bus when that data is available.
          </p>
        </div>
      </div>
      <div className="relative flex justify-center w-full h-screen">
        <BackgroundPhoto
          imgOne={BusPhotoFour}
          imgTwo={BusPhotoEight}
          imgThree={BusPhotoTen}
          imgFour={BusPhotoTwelve}
        />
        <div className="relative bottom-28 z-10 flex justify-center items-center w-full max-w-md">
          <Card className="bg-white shadow-2xl w-full border-secondary">
            <CardHeader>
              <CardTitle className="text-center text-black font-bold">
                PLAN A TRIP
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form
                  className="flex flex-col gap-4"
                  onSubmit={form.handleSubmit(onSubmit)}
                >
                  {stops.status === 'error' && (
                    <p role="alert" className="text-sm text-red-700">We couldn&apos;t load the stop list. Please refresh to try again.</p>
                  )}
                  {sourceNote && <p className="text-sm text-amber-800" role="note">{sourceNote}</p>}
                  <FormField
                    control={form.control}
                    name="departure"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <StopCombobox
                          label="Departure"
                          placeholder="Select a departure stop"
                          options={options}
                          loading={stops.status === 'loading'}
                          value={pick(field.value)}
                          onChange={(option) => field.onChange(option?.key ?? '')}
                          invalid={Boolean(errors.departure)}
                        />
                        <FormMessage className="text-red-700" />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="destination"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <StopCombobox
                          label="Destination"
                          placeholder="Select a destination stop"
                          options={options}
                          loading={stops.status === 'loading'}
                          value={pick(field.value)}
                          onChange={(option) => field.onChange(option?.key ?? '')}
                          invalid={Boolean(errors.destination)}
                        />
                        <FormMessage className="text-red-700" />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="timeToDestination"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel
                          className={`${
                            errors.timeToDestination ? 'text-red-700' : ''
                          }`}
                        >
                          Arrive by:
                        </FormLabel>
                        <FormControl>
                          <Input
                            className="w-full"
                            type="time"
                            placeholder="4:00 pm"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage className="text-red-700" />
                      </FormItem>
                    )}
                  />
                  <Button variant="secondary" type="submit">
                    FIND
                  </Button>
                  {errorMessage && (
                    <p role="alert" className="text-sm text-center text-red-700">
                      {errorMessage}
                    </p>
                  )}
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
};

export default Dashboard;
