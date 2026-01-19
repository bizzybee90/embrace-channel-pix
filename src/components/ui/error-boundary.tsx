import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    name?: string; // To identify which component crashed
}

interface State {
    hasError: boolean;
    error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error(`Uncaught error in ${this.props.name || 'Component'}:`, error, errorInfo);
    }

    private handleRetry = () => {
        this.setState({ hasError: false, error: undefined });
    };

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="p-6 border rounded-lg bg-destructive/5 border-destructive/20 text-center">
                    <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-destructive mb-2">Something went wrong</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                        {this.props.name ? `The ${this.props.name} failed to load.` : 'This section encountered an error.'}
                    </p>
                    {process.env.NODE_ENV === 'development' && this.state.error && (
                        <div className="text-xs text-left bg-black/5 p-2 rounded mb-4 overflow-auto max-h-32">
                            {this.state.error.toString()}
                        </div>
                    )}
                    <Button variant="outline" size="sm" onClick={this.handleRetry}>
                        Try Again
                    </Button>
                </div>
            );
        }

        return this.props.children;
    }
}
