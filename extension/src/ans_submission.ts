import { get_submission } from "./submissions";

type CourseInfo = {
    name: string;
    url: URL;
};

type AssignmentInfo = CourseInfo & { assignment_name: string };

export async function get_assignments_from_course(
    course_info: CourseInfo,
    session: typeof fetch,
    course_url: URL,
) {
    logger.debug(
        `Getting assignments for course ${course_info.name} from ${course_info.url}`,
    );
    const url = course_info.url;
    const results = await session(course_info.url, { method: "GET" });
    const parser = new DOMParser();
    const html = parser.parseFromString(await results.text(), "text/html");
    const assignment_infos = Array.from(html.getElementsByTagName("a"))
        .map((element): null | URL => {
            const href = element.getAttribute("href");
            if (!href) return null;
            if (!href.startsWith(course_url.toString())) return null;
            if (!href.endsWith("go_to")) return null;
            return new URL(href, BASE_URL);
        })
        .filter((el) => el !== null);

    const assignments = await Promise.all(
        assignment_infos.map(async (url, i) => {
            const response = await session(url, { method: "GET" });
            const html = parser.parseFromString(await response.text(), "text/html");
            return {
                i,
                html,
                info: assignment_infos[i],
            };
        }),
    );

    logger.debug(
        `Found ${assignment_infos.length} assignments for course ${course_info.name}`,
    );
    const tasks = assignments.map(async ({ i, html, info }) => {
        let assignment_result: URL | undefined = undefined;
        html.querySelectorAll("a").forEach((element) => {
            const href = element.getAttribute("href");
            if (!href || href.startsWith("/results/")) return;
            assignment_result = new URL(href, BASE_URL);
        });
        if (!assignment_result) {
            return;
        }
        return get_submission(assignment_result, session);
    });
    await Promise.all(tasks.filter((val) => val));
}
