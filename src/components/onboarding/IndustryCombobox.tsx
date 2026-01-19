import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

const INDUSTRIES = [
    "Cleaning Services (Residential)",
    "Cleaning Services (Commercial)",
    "Plumbing & Heating",
    "Electrical Services",
    "Legal Services",
    "Digital Marketing Agency",
    "Real Estate Agency",
    "Hospitality & Tourism",
    "Retail & E-commerce",
    "Construction & Renovation",
    "Accounting & Financial Services",
    "Event Planning & Management",
    "Fitness & Personal Training",
    "Beauty & Wellness",
    "Automotive Repair",
    "Landscaping & Gardening",
    "Consulting Services",
    "Graphic Design & Creative",
    "Education & Tutoring",
    "Health Care & Medical",
    "Property Management",
    "Tech Support & IT Services",
    "Transportation & Logistics",
    "Food & Beverage",
    "Interior Design",
    "Photography & Videography",
    "Travel Agency",
    "Security Services",
    "Pest Control",
    "Pet Care & Grooming"
]

interface IndustryComboboxProps {
    value: string;
    onChange: (value: string) => void;
}

export function IndustryCombobox({ value, onChange }: IndustryComboboxProps) {
    const [open, setOpen] = React.useState(false)
    const [searchValue, setSearchValue] = React.useState("")

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between font-normal text-left"
                >
                    {value
                        ? value
                        : <span className="text-muted-foreground">Select industry...</span>}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0 pointer-events-auto z-[50]" align="start">
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder="Search industry..."
                        value={searchValue}
                        onValueChange={setSearchValue}
                    />
                    <CommandList>
                        <CommandEmpty>
                            <div
                                className="py-6 text-center text-sm cursor-pointer hover:bg-muted/50 transition-colors"
                                onClick={() => {
                                    onChange(searchValue);
                                    setOpen(false);
                                }}
                            >
                                <p className="text-muted-foreground mb-1">No industry found.</p>
                                <p className="text-primary font-medium">Use "{searchValue}"</p>
                            </div>
                        </CommandEmpty>
                        <CommandGroup heading="Suggestions">
                            {INDUSTRIES.filter(item =>
                                item.toLowerCase().includes(searchValue.toLowerCase())
                            ).map((industry) => (
                                <CommandItem
                                    key={industry}
                                    value={industry}
                                    onSelect={(currentValue) => {
                                        onChange(currentValue === value ? "" : currentValue)
                                        setOpen(false)
                                    }}
                                >
                                    <Check
                                        className={cn(
                                            "mr-2 h-4 w-4",
                                            value === industry ? "opacity-100" : "opacity-0"
                                        )}
                                    />
                                    {industry}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
