import type WebGazerExtension from '@jspsych/extension-webgazer';
import { JsPsych, JsPsychPlugin, ParameterType, TrialType } from 'jspsych';

import { version } from '../package.json';

const info = <const>{
  name: 'webgazer-validate',
  version: version,
  parameters: {
    /** Array of points in [x,y] coordinates */
    validation_points: {
      type: ParameterType.INT, // TO DO: nested array, so different type?
      default: [
        [10, 10],
        [10, 50],
        [10, 90],
        [50, 10],
        [50, 50],
        [50, 90],
        [90, 10],
        [90, 50],
        [90, 90],
      ],
      array: true,
    },
    /**
     * Are the validation_points specified as percentages of screen width and height, or the distance in pixels from the center of the screen?
     * Options are 'percent' and 'center-offset-pixels'
     */
    validation_point_coordinates: {
      type: ParameterType.SELECT,
      default: 'percent',
      options: ['percent', 'center-offset-pixels'],
    },
    /** Tolerance around validation point in pixels */
    roi_radius: {
      type: ParameterType.INT,
      default: 200,
    },
    /** Whether or not to randomize the order of validation points */
    randomize_validation_order: {
      type: ParameterType.BOOL,
      default: false,
    },
    /** Delay before validating after showing a point */
    time_to_saccade: {
      type: ParameterType.INT,
      default: 1000,
    },
    /** Length of time to show each point */
    validation_duration: {
      type: ParameterType.INT,
      default: 2000,
    },
    /** Validation point size in pixels */
    point_size: {
      type: ParameterType.INT,
      default: 20,
    },
    /** If true, then validation data will be shown on the screen after validation is complete */
    show_validation_data: {
      type: ParameterType.BOOL,
      default: false,
    },
  },
  data: {
    /** Raw gaze data for the trial. The array will contain a nested array for each validation point. Within each nested array will be a list of `{x,y,dx,dy}` values specifying the absolute x and y pixels, as well as the distance from the target for that gaze point. */
    raw_gaze: {
      type: ParameterType.COMPLEX,
      array: true,
      nested: {
        x: {
          type: ParameterType.INT,
        },
        y: {
          type: ParameterType.INT,
        },
        dx: {
          type: ParameterType.INT,
        },
        dy: {
          type: ParameterType.INT,
        },
      },
    },
    /** The percentage of samples within the `roi_radius` for each validation point. */
    percent_in_roi: {
      type: ParameterType.FLOAT,
      array: true,
    },
    /** The average `x` and `y` distance from each validation point, plus the median distance `r` of the points from this average offset. */
    average_offset: {
      type: ParameterType.FLOAT,
      array: true,
    },
    /** The average number of samples per second. Calculated by finding samples per second for each point and then averaging these estimates together. */
    samples_per_sec: {
      type: ParameterType.FLOAT,
    },
    /** The list of validation points, in the order that they appeared. */
    validation_points: {
      type: ParameterType.INT,
      array: true,
    },
  },
  citations: '__CITATIONS__',
};

type Info = typeof info;

/**
 * This plugin can be used to measure the accuracy and precision of gaze predictions made by the
 * [WebGazer extension](../extensions/webgazer.md). For a narrative description of eye tracking with jsPsych,
 * see the [eye tracking overview](../overview/eye-tracking.md).
 *
 * @author Josh de Leeuw
 * @see {@link https://www.jspsych.org/latest/plugins/webgazer-validate/ webgazer-validate plugin} and
 * {@link https://www.jspsych.org/latest/overview/eye-tracking/ eye-tracking overview} documentation on jspsych.org
 */
class WebgazerValidatePlugin implements JsPsychPlugin<Info> {
  static info = info;

  constructor(private jsPsych: JsPsych) {}

  trial(display_element: HTMLElement, trial: TrialType<Info>) {
    const extension = this.jsPsych.extensions.webgazer as WebGazerExtension;

    var trial_data = <any>{};
    trial_data.raw_gaze = [];
    trial_data.percent_in_roi = [];
    trial_data.average_offset = [];
    trial_data.validation_points = null;

    var html = `
        <div id='webgazer-validate-container' style='position: relative; width:100vw; height:100vh; overflow: hidden;'>
        </div>`;

    display_element.innerHTML = html;

    var wg_container = display_element.querySelector('#webgazer-validate-container');

    var points_completed = -1;
    var val_points = null;
    var start = performance.now();

    // function to end trial when it is time
    const end_trial = () => {
      extension.stopSampleInterval();

      // move on to the next trial
      this.jsPsych.finishTrial(trial_data);
    };

    const validation_display = (pt) => {
      var pt_html = drawValidationPoint(pt[0], pt[1]);
      wg_container.innerHTML = pt_html;

      var pt_dom = wg_container.querySelector('.validation-point');

      var br = pt_dom.getBoundingClientRect();
      var x = br.left + br.width / 2;
      var y = br.top + br.height / 2;

      var pt_start_val = performance.now() + trial.time_to_saccade;
      var pt_finish = pt_start_val + trial.validation_duration;

      var pt_data = [];

      var cancelGazeUpdate = extension.onGazeUpdate((prediction) => {
        if (performance.now() > pt_start_val) {
          pt_data.push({
            x: prediction.x,
            y: prediction.y,
            dx: prediction.x - x,
            dy: prediction.y - y,
            t: Math.round(prediction.t - start),
          });
        }
      });

      requestAnimationFrame(function watch_dot() {
        if (performance.now() < pt_finish) {
          requestAnimationFrame(watch_dot);
        } else {
          trial_data.raw_gaze.push(pt_data);
          cancelGazeUpdate();

          next_validation_point();
        }
      });
    };

    const next_validation_point = () => {
      points_completed++;
      if (points_completed == val_points.length) {
        validation_done();
      } else {
        var pt = val_points[points_completed];
        validation_display(pt);
      }
    };

    const validate = () => {
      if (trial.randomize_validation_order) {
        val_points = this.jsPsych.randomization.shuffle(trial.validation_points);
      } else {
        val_points = trial.validation_points;
      }
      trial_data.validation_points = val_points;
      points_completed = -1;
      //extension.resume();
      extension.startSampleInterval();
      //extension.showPredictions();
      next_validation_point();
    };

    const show_validation_data = () => {
      var html = '';
      for (var i = 0; i < trial.validation_points.length; i++) {
        html += drawValidationPoint(trial.validation_points[i][0], trial.validation_points[i][1]);
        html += drawCircle(
          trial.validation_points[i][0],
          trial.validation_points[i][1],
          0,
          0,
          trial.roi_radius
        );
        for (var j = 0; j < trial_data.raw_gaze[i].length; j++) {
          html += drawRawDataPoint(
            trial.validation_points[i][0],
            trial.validation_points[i][1],
            trial_data.raw_gaze[i][j].dx,
            trial_data.raw_gaze[i][j].dy
          );
        }
      }

      html +=
        '<button id="cont" style="position:absolute; top: 50%; left:calc(50% - 50px); width: 100px;" class="jspsych-btn">Continue</btn>';
      wg_container.innerHTML = html;
      wg_container.querySelector('#cont').addEventListener('click', () => {
        extension.pause();
        end_trial();
      });
      // turn on webgazer's loop
      extension.showPredictions();
      extension.stopSampleInterval();
      extension.resume();
    };

    const validation_done = () => {
      trial_data.samples_per_sec = calculateSampleRate(trial_data.raw_gaze).toFixed(2);
      for (var i = 0; i < trial.validation_points.length; i++) {
        trial_data.percent_in_roi[i] = calculatePercentInROI(trial_data.raw_gaze[i]);
        trial_data.average_offset[i] = calculateGazeCentroid(trial_data.raw_gaze[i]);
      }
      if (trial.show_validation_data) {
        show_validation_data();
      } else {
        end_trial();
      }
    };

    validate();

    // @ts-expect-error
    function drawValidationPoint(x, y) {
      if (trial.validation_point_coordinates == 'percent') {
        return drawValidationPoint_PercentMode(x, y);
      }
      if (trial.validation_point_coordinates == 'center-offset-pixels') {
        return drawValidationPoint_CenterOffsetMode(x, y);
      }
    }

    function drawValidationPoint_PercentMode(x, y) {
      return `<div class="validation-point" style="width:${trial.point_size}px; height:${trial.point_size}px; border-radius:${trial.point_size}px; border: 1px solid #000; background-color: #333; position: absolute; left:${x}%; top:${y}%;"></div>`;
    }

    function drawValidationPoint_CenterOffsetMode(x, y) {
      return `<div class="validation-point" style="width:${trial.point_size}px; height:${
        trial.point_size
      }px; border-radius:${
        trial.point_size
      }px; border: 1px solid #000; background-color: #333; position: absolute; left:calc(50% - ${
        trial.point_size / 2
      }px + ${x}px); top:calc(50% - ${trial.point_size / 2}px + ${y}px);"></div>`;
    }

    // @ts-expect-error
    function drawCircle(target_x, target_y, dx, dy, r) {
      if (trial.validation_point_coordinates == 'percent') {
        return drawCircle_PercentMode(target_x, target_y, dx, dy, r);
      }
      if (trial.validation_point_coordinates == 'center-offset-pixels') {
        return drawCircle_CenterOffsetMode(target_x, target_y, dx, dy, r);
      }
    }

    function drawCircle_PercentMode(target_x, target_y, dx, dy, r) {
      var html = `
          <div class="validation-centroid" style="width:${r * 2}px; height:${
        r * 2
      }px; border: 2px dotted #ccc; border-radius: ${r}px; background-color: transparent; position: absolute; left:calc(${target_x}% + ${
        dx - r
      }px); top:calc(${target_y}% + ${dy - r}px);"></div>
        `;
      return html;
    }

    function drawCircle_CenterOffsetMode(target_x, target_y, dx, dy, r) {
      var html = `
          <div class="validation-centroid" style="width:${r * 2}px; height:${
        r * 2
      }px; border: 2px dotted #ccc; border-radius: ${r}px; background-color: transparent; position: absolute; left:calc(50% + ${target_x}px + ${
        dx - r
      }px); top:calc(50% + ${target_y}px + ${dy - r}px);"></div>
        `;
      return html;
    }

    // @ts-expect-error
    function drawRawDataPoint(target_x, target_y, dx, dy) {
      if (trial.validation_point_coordinates == 'percent') {
        return drawRawDataPoint_PercentMode(target_x, target_y, dx, dy);
      }
      if (trial.validation_point_coordinates == 'center-offset-pixels') {
        return drawRawDataPoint_CenterOffsetMode(target_x, target_y, dx, dy);
      }
    }

    function drawRawDataPoint_PercentMode(target_x, target_y, dx, dy) {
      var color = Math.sqrt(dx * dx + dy * dy) <= trial.roi_radius ? '#afa' : '#faa';
      return `<div class="raw-data-point" style="width:5px; height:5px; border-radius:5px; background-color: ${color}; opacity:0.8; position: absolute; left:calc(${target_x}% + ${
        dx - 2
      }px); top:calc(${target_y}% + ${dy - 2}px);"></div>`;
    }

    function drawRawDataPoint_CenterOffsetMode(target_x, target_y, dx, dy) {
      var color = Math.sqrt(dx * dx + dy * dy) <= trial.roi_radius ? '#afa' : '#faa';
      return `<div class="raw-data-point" style="width:5px; height:5px; border-radius:5px; background-color: ${color}; opacity:0.8; position: absolute; left:calc(50% + ${target_x}px + ${
        dx - 2
      }px); top:calc(50% + ${target_y}px + ${dy - 2}px);"></div>`;
    }

    function median(arr) {
      var mid = Math.floor(arr.length / 2);
      var sorted_arr = arr.sort((a, b) => a - b);
      if (arr.length % 2 == 0) {
        return sorted_arr[mid - 1] + sorted_arr[mid] / 2;
      } else {
        return sorted_arr[mid];
      }
    }

    function calculateGazeCentroid(gazeData) {
      var x_diff_m = gazeData.reduce((accumulator, currentValue, index) => {
        accumulator += currentValue.dx;
        if (index == gazeData.length - 1) {
          return accumulator / gazeData.length;
        } else {
          return accumulator;
        }
      }, 0);

      var y_diff_m = gazeData.reduce((accumulator, currentValue, index) => {
        accumulator += currentValue.dy;
        if (index == gazeData.length - 1) {
          return accumulator / gazeData.length;
        } else {
          return accumulator;
        }
      }, 0);

      var median_distance = median(
        gazeData.map((x) => Math.sqrt(Math.pow(x.dx - x_diff_m, 2) + Math.pow(x.dy - y_diff_m, 2)))
      );

      return {
        x: x_diff_m,
        y: y_diff_m,
        r: median_distance,
      };
    }

    function calculatePercentInROI(gazeData) {
      var distances = gazeData.map((p) => Math.sqrt(Math.pow(p.dx, 2) + Math.pow(p.dy, 2)));
      var sum_in_roi = distances.reduce((accumulator, currentValue) => {
        if (currentValue <= trial.roi_radius) {
          accumulator++;
        }
        return accumulator;
      }, 0);
      var percent = (sum_in_roi / gazeData.length) * 100;
      return percent;
    }

    function calculateSampleRate(gazeData) {
      var mean_diff = [];
      if (gazeData.length == 0) {
        return 0;
      }
      for (var i = 0; i < gazeData.length; i++) {
        if (gazeData[i].length > 1) {
          var t_diff = [];
          for (var j = 1; j < gazeData[i].length; j++) {
            t_diff.push(gazeData[i][j].t - gazeData[i][j - 1].t);
          }
          mean_diff.push(t_diff.reduce((a, b) => a + b, 0) / t_diff.length);
        }
      }
      if (mean_diff.length > 0) {
        return 1000 / (mean_diff.reduce((a, b) => a + b, 0) / mean_diff.length);
      } else {
        return null;
      }
    }
  }
}

export default WebgazerValidatePlugin;
