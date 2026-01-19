
import React from 'react';
import { cn } from '@/lib/utils';

interface LogoProps {
    className?: string;
}

export const Logo: React.FC<LogoProps> = ({ className }) => {
    return (
        <div className={cn("flex items-center gap-2", className)}>
            <div className="bg-primary/10 p-2 rounded-lg">
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="w-full h-full text-primary"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <path d="M12 8v8" />
                    <path d="M12 16l4-2.5" />
                    <path d="M12 16l-4-2.5" />
                </svg>
            </div>
            <span className="font-bold text-xl tracking-tight">BizzyBee</span>
        </div>
    );
};
