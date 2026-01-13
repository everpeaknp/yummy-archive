"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, addDays, subDays } from 'date-fns';

interface DateSelectorProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  availableDates: string[]; // List of YYYY-MM-DD
}

export function DateSelector({ selectedDate, onDateChange, availableDates }: DateSelectorProps) {

  const handlePrev = () => onDateChange(subDays(selectedDate, 1));
  const handleNext = () => onDateChange(addDays(selectedDate, 1));

  return (
    <div className="flex items-center space-x-4">
       <Button variant="outline" size="icon" onClick={handlePrev}>
          <ChevronLeft className="h-4 w-4" />
       </Button>
       <div className="flex items-center space-x-2 border rounded-md px-4 py-2 bg-white">
          <CalendarIcon className="h-5 w-5 text-black" />
          <span className="font-medium text-lg">{format(selectedDate, 'PPP')}</span>
       </div>
       <Button variant="outline" size="icon" onClick={handleNext}>
          <ChevronRight className="h-4 w-4" />
       </Button>
    </div>
  );
}
