import zip from "../utils/zip";
import {
  Point2D,
  Curve2D,
  samePoint as defaultSamePoint,
  intersectCurves,
  removeDuplicatePoints,
} from "../lib2d";

import Blueprint from "./Blueprint";
import Blueprints from "./Blueprints";
import CompoundBlueprint from "./CompoundBlueprint";
import { organiseBlueprints } from "./lib";

const PRECISION = 1e-9;

const samePoint = (x: Point2D, y: Point2D) => defaultSamePoint(x, y, PRECISION);

const curveMidPoint = (curve: Curve2D) => {
  // (lp - fp) / 2 + fp
  const midParameter = (curve.lastParameter + curve.firstParameter) / 2;
  return curve.value(midParameter);
};

const rotateToStartAt = (curves: Curve2D[], point: Point2D) => {
  const startIndex = curves.findIndex((curve: Curve2D) => {
    return samePoint(point, curve.firstPoint);
  });

  const start = curves.slice(0, startIndex);
  const end = curves.slice(startIndex);

  return end.concat(start);
};

const rotateToStartAtSegment = (curves: Curve2D[], segment: Curve2D) => {
  const onSegment = (curve: Curve2D) => {
    return (
      samePoint(segment.firstPoint, curve.firstPoint) &&
      samePoint(segment.lastPoint, curve.lastPoint)
    );
  };

  let startIndex = curves.findIndex(onSegment);

  // it is also possible that the segment is oriented the other way. We still
  // need to align a start point
  if (startIndex === -1) {
    curves = reverseSegment(curves);
    startIndex = curves.findIndex(onSegment);
    if (startIndex === -1) {
      console.error(
        curves.map((c) => c.repr),
        segment.repr
      );
      throw new Error("Failed to rotate to segment start");
    }
  }

  const start = curves.slice(0, startIndex);
  const end = curves.slice(startIndex);

  return end.concat(start);
};

function* createSegmentOnPoints(
  curves: Curve2D[],
  allIntersections: Point2D[],
  allCommonSegments: Curve2D[]
) {
  const endsAtIntersection = (curve: Curve2D) => {
    return !!allIntersections.find((intersection) => {
      return samePoint(intersection, curve.lastPoint);
    });
  };

  const isCommonSegment = (curve: Curve2D) => {
    return !!allCommonSegments.find((segment) => {
      return (
        (samePoint(segment.firstPoint, curve.firstPoint) &&
          samePoint(segment.lastPoint, curve.lastPoint)) ||
        (samePoint(segment.firstPoint, curve.lastPoint) &&
          samePoint(segment.lastPoint, curve.firstPoint))
      );
    });
  };

  let currentCurves = [];
  for (const curve of curves) {
    if (endsAtIntersection(curve)) {
      currentCurves.push(curve);
      yield currentCurves;
      currentCurves = [];
    } else if (isCommonSegment(curve)) {
      if (currentCurves.length) {
        yield currentCurves;
        currentCurves = [];
      }
      yield [curve];
    } else {
      currentCurves.push(curve);
    }
  }
  if (currentCurves.length) {
    yield currentCurves;
  }
}

type Segment = Array<Curve2D>;
type IntersectionSegment = [Segment, Segment | "same"];

const startOfSegment = (s: Segment): Point2D => {
  return s[0].firstPoint;
};

const endOfSegment = (s: Segment): Point2D => {
  return s[s.length - 1].lastPoint;
};

const reverseSegment = (segment: Segment) => {
  segment.reverse();
  return segment.map((curve) => {
    const newCurve = curve.clone();
    newCurve.reverse();
    return newCurve;
  });
};

const reverseSegments = (s: Segment[]) => {
  s.reverse();
  return s.map(reverseSegment);
};

function removeNonCrossingPoint(
  allIntersections: Point2D[],
  segmentedCurve: Curve2D[],
  blueprintToCheck: Blueprint
) {
  return allIntersections.filter((intersection: Point2D) => {
    const segmentsOfIntersection = segmentedCurve.filter((s) => {
      return (
        samePoint(s.firstPoint, intersection) ||
        samePoint(s.lastPoint, intersection)
      );
    });
    if (segmentsOfIntersection.length % 2) {
      console.error(segmentsOfIntersection, intersection);
      throw new Error("Bug in the intersection algo on non crossing point");
    }

    const isInside = segmentsOfIntersection.map((segment: Curve2D): boolean => {
      return blueprintToCheck.isInside(curveMidPoint(segment));
    });

    // Either they are all inside or outside
    const segmentsOnTheSameSide =
      isInside.every((i) => i) || !isInside.some((i) => i);

    return !segmentsOnTheSameSide;
  });
}

/* When two shape intersect we cut them into segments between the intersection
 * points.
 *
 * This function returns the list of segments that have the same start and end
 * at the same intersection points or null if there is no intersection.
 *
 * The function assumes that the blueprints are closed
 */
function blueprintsIntersectionSegments(
  first: Blueprint,
  second: Blueprint
): IntersectionSegment[] | null {
  // For each curve of each blueprint we figure out where the intersection
  // points are.
  let allIntersections: Point2D[] = [];
  const allCommonSegments: Curve2D[] = [];

  const firstCurvePoints: Point2D[][] = new Array(first.curves.length)
    .fill(0)
    .map(() => []);
  const secondCurvePoints: Point2D[][] = new Array(second.curves.length)
    .fill(0)
    .map(() => []);

  first.curves.forEach((thisCurve, firstIndex) => {
    second.curves.forEach((otherCurve, secondIndex) => {
      // The algorithm used here seems to fail for smaller precisions (it
      // detects overlaps in circle that do not exist
      const { intersections, commonSegments, commonSegmentsPoints } =
        intersectCurves(thisCurve, otherCurve, PRECISION / 100);

      allIntersections.push(...intersections);
      firstCurvePoints[firstIndex].push(...intersections);
      secondCurvePoints[secondIndex].push(...intersections);

      allCommonSegments.push(...commonSegments);
      allIntersections.push(...commonSegmentsPoints);
      firstCurvePoints[firstIndex].push(...commonSegmentsPoints);
      secondCurvePoints[secondIndex].push(...commonSegmentsPoints);
    });
  });

  allIntersections = removeDuplicatePoints(allIntersections, PRECISION);

  // If there is only one intersection point we consider that the blueprints
  // are not intersecting
  if (!allIntersections.length || allIntersections.length === 1) return null;

  // We further split the curves at the intersections
  const cutCurve = ([curve, intersections]: [
    Curve2D,
    Point2D[]
  ]): Curve2D[] => {
    if (!intersections.length) return [curve];
    return curve.splitAt(intersections, PRECISION / 100);
  };
  let firstCurveSegments = zip([first.curves, firstCurvePoints] as [
    Curve2D[],
    Point2D[][]
  ]).flatMap(cutCurve);

  let secondCurveSegments = zip([second.curves, secondCurvePoints] as [
    Curve2D[],
    Point2D[][]
  ]).flatMap(cutCurve);

  const commonSegmentsPoints = allCommonSegments.map((c) => [
    c.firstPoint,
    c.lastPoint,
  ]);

  // We need to remove intersection points that are not crossing into each
  // other (i.e. the two blueprints are only touching in one point and not
  // intersecting there.)
  allIntersections = removeNonCrossingPoint(
    allIntersections,
    firstCurveSegments,
    second
  );

  if (!allIntersections.length && !allCommonSegments.length) return null;

  // We align the beginning of the curves
  if (!allCommonSegments.length) {
    const startAt = allIntersections[0];
    firstCurveSegments = rotateToStartAt(firstCurveSegments, startAt);
    secondCurveSegments = rotateToStartAt(secondCurveSegments, startAt);
  } else {
    // When there are common segments we always start on one
    const startSegment = allCommonSegments[0];
    firstCurveSegments = rotateToStartAtSegment(
      firstCurveSegments,
      startSegment
    );
    secondCurveSegments = rotateToStartAtSegment(
      secondCurveSegments,
      startSegment
    );
  }

  // We group curves in segments
  const firstIntersectedSegments = Array.from(
    createSegmentOnPoints(
      firstCurveSegments,
      allIntersections,
      allCommonSegments
    )
  );
  let secondIntersectedSegments = Array.from(
    createSegmentOnPoints(
      secondCurveSegments,
      allIntersections,
      allCommonSegments
    )
  );
  if (
    !samePoint(
      endOfSegment(secondIntersectedSegments[0]),
      endOfSegment(firstIntersectedSegments[0])
    ) ||
    (allCommonSegments.length > 0 && secondIntersectedSegments[0].length !== 1)
  ) {
    secondIntersectedSegments = reverseSegments(secondIntersectedSegments);
  }

  return zip([firstIntersectedSegments, secondIntersectedSegments]).map(
    ([first, second]) => {
      //if (first.length !== 1 || second.length !== 1) return [first, second];

      const currentStart = startOfSegment(first);
      const currentEnd = endOfSegment(first);

      if (
        commonSegmentsPoints.find(([startPoint, endPoint]) => {
          return (
            (samePoint(startPoint, currentStart) &&
              samePoint(endPoint, currentEnd)) ||
            (samePoint(startPoint, currentEnd) &&
              samePoint(startPoint, currentStart))
          );
        })
      ) {
        return [first, "same"];
      }
      return [first, second];
    }
  );
}

const splitPaths = (curves: Curve2D[]) => {
  const startPoints = curves.map((c) => c.firstPoint);
  let endPoints = curves.map((c) => c.lastPoint);
  endPoints = endPoints.slice(-1).concat(endPoints.slice(0, -1));

  const discontinuities = zip([startPoints, endPoints])
    .map(([startPoint, endPoint], index) => {
      if (!samePoint(startPoint, endPoint)) {
        return index;
      }
      return null;
    })
    .filter((f) => f !== null) as number[];

  if (!discontinuities.length) return [curves];

  const paths = zip([
    discontinuities.slice(0, -1),
    discontinuities.slice(1),
  ]).map(([start, end]) => {
    return curves.slice(start, end);
  });

  let lastPath = curves.slice(discontinuities[discontinuities.length - 1]);
  if (discontinuities[0] !== 0) {
    lastPath = lastPath.concat(curves.slice(0, discontinuities[0]));
  }
  paths.push(lastPath);

  return paths;
};

function booleanOperation(
  first: Blueprint,
  second: Blueprint,
  {
    firstInside,
    secondInside,
  }: {
    firstInside: "keep" | "remove";
    secondInside: "keep" | "remove";
  }
):
  | Blueprint
  | Blueprints
  | null
  | { identical: true }
  | {
      firstCurveInSecond: boolean;
      secondCurveInFirst: boolean;
      identical: false;
    } {
  const segments = blueprintsIntersectionSegments(first, second);

  // The case where we have no intersections
  if (!segments) {
    const firstBlueprintPoint = curveMidPoint(first.curves[0]);
    const firstCurveInSecond = second.isInside(firstBlueprintPoint);

    const secondBlueprintPoint = curveMidPoint(second.curves[0]);
    const secondCurveInFirst = first.isInside(secondBlueprintPoint);

    return {
      identical: false,
      firstCurveInSecond,
      secondCurveInFirst,
    };
  }

  if (segments.every(([, secondSegment]) => secondSegment === "same")) {
    return { identical: true };
  }

  let lastWasSame: null | Segment = null;
  let segmentsIn: number | null = null;

  const s = segments.flatMap(([firstSegment, secondSegment]) => {
    let segments: Segment = [];
    let segmentsOut = 0;

    // When two segments are on top of each other we base our decision on the
    // fact that every point should have one segment entering, and one going
    // out.
    if (secondSegment === "same") {
      if (segmentsIn === 1) {
        segmentsIn = 1;
        return [...firstSegment];
      }

      if (segmentsIn === 2 || segmentsIn === 0) {
        segmentsIn = null;
        return [];
      }

      if (segmentsIn === null) {
        if (!lastWasSame) lastWasSame = firstSegment;
        else lastWasSame = [...lastWasSame, ...firstSegment];
        return [];
      }

      console.error("weird situation");
      return [];
    }

    // Every segment is kept or removed according to the fact that it is within
    // or not of the other closed blueprint

    const firstSegmentPoint = curveMidPoint(firstSegment[0]);
    const firstSegmentInSecondShape = second.isInside(firstSegmentPoint);
    if (
      (firstInside === "keep" && firstSegmentInSecondShape) ||
      (firstInside === "remove" && !firstSegmentInSecondShape)
    ) {
      segmentsOut += 1;
      segments.push(...firstSegment);
    }

    const secondSegmentPoint = curveMidPoint(secondSegment[0]);
    const secondSegmentInFirstShape = first.isInside(secondSegmentPoint);

    if (
      (secondInside === "keep" && secondSegmentInFirstShape) ||
      (secondInside === "remove" && !secondSegmentInFirstShape)
    ) {
      let segmentsToAdd = secondSegment;

      // When there are only two segments we cannot know if we are in the
      // same until here - so it is possible that they are mismatched.
      if (segmentsOut === 1) {
        segmentsToAdd = reverseSegment(secondSegment);
      }
      segmentsOut += 1;
      segments.push(...segmentsToAdd);
    }

    // This is the case where the information about the segments entering the
    // previous node where not known and no segment was selected
    if (segmentsIn === null && segmentsOut === 1 && lastWasSame) {
      segments = [...lastWasSame, ...segments];
    }

    if (segmentsOut === 1) {
      segmentsIn = segmentsOut;
      lastWasSame = null;
    }
    return segments;
  });

  // It is possible to have more than one resulting out blueprint, we make sure
  // to split them
  const paths = splitPaths(s)
    .filter((b) => b.length)
    .map((b) => new Blueprint(b));

  if (paths.length === 0) return null;
  if (paths.length === 1) return paths[0];

  return organiseBlueprints(paths);
}

export const fuseBlueprints = (
  first: Blueprint,
  second: Blueprint
): null | Blueprint | Blueprints => {
  const result = booleanOperation(first, second, {
    firstInside: "remove",
    secondInside: "remove",
  });

  if (
    result === null ||
    result instanceof Blueprint ||
    result instanceof Blueprints
  )
    return result;

  if (result.identical) {
    return first.clone();
  }

  if (result.firstCurveInSecond) {
    return second.clone();
  }

  if (result.secondCurveInFirst) {
    return first.clone();
  }

  return new Blueprints([first, second]);
};

export const cutBlueprints = (
  first: Blueprint,
  second: Blueprint
): null | Blueprint | Blueprints => {
  const result = booleanOperation(first, second, {
    firstInside: "remove",
    secondInside: "keep",
  });

  if (
    result === null ||
    result instanceof Blueprint ||
    result instanceof Blueprints
  )
    return result;

  if (result.identical) {
    return null;
  }

  if (result.firstCurveInSecond) {
    return null;
  }

  if (result.secondCurveInFirst) {
    return new Blueprints([new CompoundBlueprint([first, second])]);
  }

  return first.clone();
};

export const intersectBlueprints = (
  first: Blueprint,
  second: Blueprint
): null | Blueprint | Blueprints => {
  const result = booleanOperation(first, second, {
    firstInside: "keep",
    secondInside: "keep",
  });

  if (
    result === null ||
    result instanceof Blueprint ||
    result instanceof Blueprints
  )
    return result;

  if (result.identical) {
    return first.clone();
  }

  if (result.firstCurveInSecond) {
    return first.clone();
  }

  if (result.secondCurveInFirst) {
    return second.clone();
  }

  return null;
};
