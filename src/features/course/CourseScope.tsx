import { Stack } from 'expo-router';
import type { ReactNode } from 'react';

import { useDashboardCourses } from '@/canvas/api/courses';
import { useAllCourses } from '@/canvas/api/tabs';
import { AccentScope, deriveAccent, useTheme } from '@/design';

/**
 * The student's color for a course. Dashboard courses carry it already; past and
 * future courses fall back to the All courses list.
 */
export function useCourseColor(courseId: string): string | null {
  const dashboard = useDashboardCourses();
  const fromDashboard = dashboard.data?.find((c) => c.id === courseId)?.color;
  const all = useAllCourses({ enabled: dashboard.isSuccess && !fromDashboard });
  return fromDashboard ?? all.data?.find((c) => c.id === courseId)?.color ?? null;
}

type Props = {
  courseId: string;
  /** Header title. */
  title: string;
  children: ReactNode;
};

/** Course screens: tinted with the course color, header included. */
export function CourseScope({ courseId, title, children }: Props) {
  const color = useCourseColor(courseId);
  const { scheme } = useTheme();
  return (
    <AccentScope color={color} className="flex-1">
      <Stack.Screen
        options={{ title, ...(color && { headerTintColor: deriveAccent(color, scheme).accentFg }) }}
      />
      {children}
    </AccentScope>
  );
}
