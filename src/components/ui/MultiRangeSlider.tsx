import React, { useCallback, useEffect, useState, useRef } from 'react';
import { cn } from '@/lib/utils';

interface MultiRangeSliderProps {
  min: number;
  max: number;
  minVal: number;
  maxVal: number;
  onChange: (values: { min: number; max: number }) => void;
  className?: string;
}

const MultiRangeSlider: React.FC<MultiRangeSliderProps> = ({
  min,
  max,
  minVal,
  maxVal,
  onChange,
  className,
}) => {
  const [minInternal, setMinInternal] = useState(minVal);
  const [maxInternal, setMaxInternal] = useState(maxVal);
  const minValRef = useRef(minVal);
  const maxValRef = useRef(maxVal);
  const range = useRef<HTMLDivElement>(null);

  // Sync internal state with props only when props significantly change (avoid loops)
  useEffect(() => {
    if (minVal !== minInternal) setMinInternal(minVal);
    if (maxVal !== maxInternal) setMaxInternal(maxVal);
  }, [minVal, maxVal]);

  const getPercent = useCallback(
    (value: number) => {
      if (max === min) return 0;
      return Math.round(((value - min) / (max - min)) * 100);
    },
    [min, max]
  );

  // Update selection range (blue bar)
  useEffect(() => {
    const minPercent = getPercent(minInternal);
    const maxPercent = getPercent(maxInternal);

    if (range.current) {
      range.current.style.left = `${minPercent}%`;
      range.current.style.width = `${maxPercent - minPercent}%`;
    }
  }, [minInternal, maxInternal, getPercent]);

  const handleMinChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = Math.min(Number(event.target.value), maxInternal - 1);
    setMinInternal(value);
    minValRef.current = value;
    onChange({ min: value, max: maxInternal });
  }

  const handleMaxChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = Math.max(Number(event.target.value), minInternal + 1);
    setMaxInternal(value);
    maxValRef.current = value;
    onChange({ min: minInternal, max: value });
  }

  return (
    <div className={cn("relative w-full h-6 flex items-center select-none", className)}>
      {/* Invisible Range Inputs */}
      <input
        type="range"
        min={min}
        max={max}
        value={minInternal}
        onChange={handleMinChange}
        className={cn(
          "pointer-events-none absolute h-0 w-full outline-none z-[3] opacity-0",
          "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-[18px] [&::-webkit-slider-thumb]:w-[18px] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:rounded-full",
          "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-[18px] [&::-moz-range-thumb]:w-[18px] [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full"
        )}
        style={{ zIndex: minInternal > max - 100 ? 5 : 3 }}
      />
      <input
        type="range"
        min={min}
        max={max}
        value={maxInternal}
        onChange={handleMaxChange}
        className={cn(
          "pointer-events-none absolute h-0 w-full outline-none z-[4] opacity-0",
          "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-[18px] [&::-webkit-slider-thumb]:w-[18px] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:rounded-full",
          "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-[18px] [&::-moz-range-thumb]:w-[18px] [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full"
        )}
      />

      {/* Visual Track */}
      <div className="relative w-full">
        {/* Background Track */}
        <div className="absolute top-0 bottom-0 left-0 right-0 h-[6px] w-full rounded-full bg-slate-200" />
        
        {/* Active Range Track */}
        <div ref={range} className="absolute top-0 bottom-0 h-[6px] rounded-full bg-blue-500 z-[2]" />

        {/* Visual Thumbs - Perfectly Aligned with invisible inputs */}
        {/* Left Thumb */}
        <div 
          className="absolute z-[2] h-[18px] w-[18px] -ml-[9px] -mt-[6px] rounded-full border border-slate-300 bg-white shadow-sm transition-transform hover:scale-110"
          style={{ left: `${getPercent(minInternal)}%` }}
        />
        {/* Right Thumb */}
        <div 
          className="absolute z-[2] h-[18px] w-[18px] -ml-[9px] -mt-[6px] rounded-full border border-slate-300 bg-white shadow-sm transition-transform hover:scale-110"
          style={{ left: `${getPercent(maxInternal)}%` }}
        />
      </div>
    </div>
  );
};

export default MultiRangeSlider;
