export type RecruitmentOption = {day:string;area:string};

/** Every selected day and area must participate in a published combination. */
export function hasRecruitmentSelection(events:RecruitmentOption[],dates:string[],areas:string[]){
 const matching=events.filter(e=>dates.includes(e.day)&&areas.includes(e.area));
 return dates.length>0&&areas.length>0&&dates.every(day=>matching.some(e=>e.day===day))&&areas.every(area=>matching.some(e=>e.area===area));
}
