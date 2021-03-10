import cloneDeep from 'lodash/cloneDeep';
import isEqual from 'lodash/isEqual';

import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
} from '@angular/core';
import { ControlValueAccessor } from '@angular/forms';
import { convertSchemaToDraft6 } from './shared/convert-schema-to-draft6.function';
import { forEach, hasOwn } from './shared/utility.functions';
import {
  hasValue,
  inArray,
  isArray,
  isEmpty,
  isObject
} from './shared/validator.functions';
import { JsonPointer } from './shared/jsonpointer.functions';
import { JsonSchemaFormService } from './json-schema-form.service';
import { resolveSchemaReferences } from './shared/json-schema.functions';
import { WidgetLibraryService } from './widget-library/widget-library.service';


@Component({
  // tslint:disable-next-line:component-selector
  selector: 'json-schema-form',
  templateUrl: './json-schema-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class JsonSchemaFormComponent implements ControlValueAccessor, OnChanges, OnInit {
  debugOutput: any; // Debug information, if requested
  formValueSubscription: any = null;
  formInitialized = false;
  objectWrap = false; // Is non-object input schema wrapped in an object?

  formValuesInput: string; // Name of the input providing the form data
  previousInputs: { // Previous input values, to detect which input triggers onChanges
    schema: any, layout: any[], data: any, options: any, framework: any | string,
    widgets: any, form: any, model: any, JSONSchema: any, UISchema: any,
    formData: any, loadExternalAssets: boolean, debug: boolean,
  } = {
      schema: null, layout: null, data: null, options: null, framework: null,
      widgets: null, form: null, model: null, JSONSchema: null, UISchema: null,
      formData: null, loadExternalAssets: null, debug: null,
    };

  // Recommended inputs
  @Input() schema: any; // The JSON Schema
  @Input() layout: any[]; // The form layout
  @Input() data: any; // The form data
  @Input() options: any; // The global form options
  @Input() widgets: any; // Any custom widgets to load

  // Alternate combined single input
  @Input() form: any; // For testing, and JSON Schema Form API compatibility

  // Angular Schema Form API compatibility input
  @Input() model: any; // Alternate input for form data

  // React JSON Schema Form API compatibility inputs
  // @Input() JSONSchema: any; // Alternate input for JSON Schema
  @Input() formData: any; // Alternate input for form data

  @Input() ngModel: any; // Alternate input for Angular forms
  @Input() debug: boolean; // Show debug information?

  @Input()
  get value(): any {
    return this.objectWrap ? this.jsf.data['1'] : this.jsf.data;
  }
  set value(value: any) {
    this.setFormValues(value, false);
  }

  // Outputs
  @Output() onChanges = new EventEmitter<any>(); // Live unvalidated internal form data
  @Output() onSubmit = new EventEmitter<any>(); // Complete validated form data
  @Output() isValid = new EventEmitter<boolean>(); // Is current data valid?
  @Output() validationErrors = new EventEmitter<any>(); // Validation errors (if any)
  @Output() formSchema = new EventEmitter<any>(); // Final schema used to create form
  @Output() formLayout = new EventEmitter<any>(); // Final layout used to create form

  // Outputs for possible 2-way data binding
  // Only the one input providing the initial form data will be bound.
  // If there is no inital data, input '{}' to activate 2-way data binding.
  // There is no 2-way binding if inital data is combined inside the 'form' input.
  @Output() dataChange = new EventEmitter<any>();
  @Output() modelChange = new EventEmitter<any>();
  @Output() formDataChange = new EventEmitter<any>();
  @Output() ngModelChange = new EventEmitter<any>();

  onChange: Function;
  onTouched: Function;

  constructor(
    private changeDetector: ChangeDetectorRef,
    private widgetLibrary: WidgetLibraryService,
    public jsf: JsonSchemaFormService,
  ) { }

  private resetScriptsAndStyleSheets() {
    document.querySelectorAll('.ajsf').forEach(element => element.remove());
  }

  private loadAssets() {
    this.resetScriptsAndStyleSheets();

  }
  ngOnInit() {
    this.updateForm();
    this.loadAssets();
  }

  ngOnChanges(changes: SimpleChanges) {
    this.updateForm();
    // Check if there's changes in Framework then load assets if that's the
  }

  writeValue(value: any) {
    this.setFormValues(value, false);
    if (!this.formValuesInput) { this.formValuesInput = 'ngModel'; }
  }

  registerOnChange(fn: Function) {
    this.onChange = fn;
  }

  registerOnTouched(fn: Function) {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean) {
    if (this.jsf.formOptions.formDisabled !== !!isDisabled) {
      this.jsf.formOptions.formDisabled = !!isDisabled;
      this.initializeForm();
    }
  }

  updateForm() {
    if (!this.formInitialized || !this.formValuesInput
    ) {
      this.initializeForm();
    } else {

      // Get names of changed inputs
      let changedInput = Object.keys(this.previousInputs)
        .filter(input => this.previousInputs[input] !== this[input]);
      let resetFirst = true;
      if (changedInput.length === 1 && changedInput[0] === 'form' &&
        this.formValuesInput.startsWith('form.')
      ) {
        // If only 'form' input changed, get names of changed keys
        changedInput = Object.keys(this.previousInputs.form || {})
          .filter(key => !isEqual(this.previousInputs.form[key], this.form[key]))
          .map(key => `form.${key}`);
        resetFirst = false;
      }

      // If only input values have changed, update the form values
      if (changedInput.length === 1 && changedInput[0] === this.formValuesInput) {
        if (this.formValuesInput.indexOf('.') === -1) {
          this.setFormValues(this[this.formValuesInput], resetFirst);
        } else {
          const [input, key] = this.formValuesInput.split('.');
          this.setFormValues(this[input][key], resetFirst);
        }

        // If anything else has changed, re-render the entire form
      } else if (changedInput.length) {
        this.initializeForm();
        if (this.onChange) { this.onChange(this.jsf.formValues); }
        if (this.onTouched) { this.onTouched(this.jsf.formValues); }
      }

      // Update previous inputs
      Object.keys(this.previousInputs)
        .filter(input => this.previousInputs[input] !== this[input])
        .forEach(input => this.previousInputs[input] = this[input]);
    }
  }

  setFormValues(formValues: any, resetFirst = true) {
    if (formValues) {
      const newFormValues = this.objectWrap ? formValues['1'] : formValues;
      if (!this.jsf.formGroup) {
        this.jsf.formValues = formValues;
        this.activateForm();
      } else if (resetFirst) {
        this.jsf.formGroup.reset();
      }
      if (this.jsf.formGroup) {
        this.jsf.formGroup.patchValue(newFormValues);
      }
      if (this.onChange) { this.onChange(newFormValues); }
      if (this.onTouched) { this.onTouched(newFormValues); }
    } else {
      this.jsf.formGroup.reset();
    }
  }

  submitForm() {
    const validData = this.jsf.validData;
    this.onSubmit.emit(this.objectWrap ? validData['1'] : validData);
  }


  initializeForm() {
    if (
      this.schema || this.layout || this.data || this.form || this.model || this.formData || this.ngModel ||
      this.jsf.data
    ) {

      this.jsf.resetAllValues();  // Reset all form values to defaults
      this.initializeOptions();   // Update options
      this.initializeSchema();    // Update schema, schemaRefLibrary,
      // schemaRecursiveRefMap, & dataRecursiveRefMap
      this.initializeLayout();    // Update layout, layoutRefLibrary,
      this.initializeData();      // Update formValues
      this.activateForm();        // Update dataMap, templateRefLibrary,
      // formGroupTemplate, formGroup

      if (this.debug || this.jsf.formOptions.debug) {
        const vars: any[] = [];

        this.debugOutput = vars.map(v => JSON.stringify(v, null, 2)).join('\n');
      }
      this.formInitialized = true;
    }
  }

  /**
   * 'initializeOptions' function
   *
   * Initialize 'options' (global form options) and set framework
   * Combine available inputs:
   * 1. options - recommended
   * 2. form.options - Single input style
   */
  private initializeOptions() {

    this.jsf.setOptions({ debug: !!this.debug });
    let loadExternalAssets: boolean = false;
    let framework: any =  'default';
    if (isObject(this.options)) {
      this.jsf.setOptions(this.options);
      loadExternalAssets = this.options.loadExternalAssets || loadExternalAssets;
      framework = this.options.framework || framework;
    }
    if (isObject(this.form) && isObject(this.form.options)) {
      this.jsf.setOptions(this.form.options);
      loadExternalAssets = this.form.options.loadExternalAssets || loadExternalAssets;
      framework = this.form.options.framework || framework;
    }
    if (isObject(this.widgets)) {
      this.jsf.setOptions({ widgets: this.widgets });
    }

    if (isObject(this.jsf.formOptions.widgets)) {
      for (const widget of Object.keys(this.jsf.formOptions.widgets)) {
        this.widgetLibrary.registerWidget(widget, this.jsf.formOptions.widgets[widget]);
      }
    }
    if (isObject(this.form) && isObject(this.form.tpldata)) {
      this.jsf.setTpldata(this.form.tpldata);
    }
  }


  private initializeSchema() {

    // TODO: update to allow non-object schemas

    if (isObject(this.schema)) {
      this.jsf.AngularSchemaFormCompatibility = true;
      this.jsf.schema = cloneDeep(this.schema);
    } else if (hasOwn(this.form, 'schema') && isObject(this.form.schema)) {
      this.jsf.schema = cloneDeep(this.form.schema);
    } else if (isObject(this.form)) {
      // TODO: Handle other types of form input
    }

    if (!isEmpty(this.jsf.schema)) {

      // If other types also allowed, render schema as an object
      if (inArray('object', this.jsf.schema.type)) {
        this.jsf.schema.type = 'object';
      }

      // Wrap non-object schemas in object.
      if (hasOwn(this.jsf.schema, 'type') && this.jsf.schema.type !== 'object') {
        this.jsf.schema = {
          'type': 'object',
          'properties': { 1: this.jsf.schema }
        };
        this.objectWrap = true;
      } else if (!hasOwn(this.jsf.schema, 'type')) {

        // Add type = 'object' if missing
        if (isObject(this.jsf.schema.properties) ||
          isObject(this.jsf.schema.patternProperties) ||
          isObject(this.jsf.schema.additionalProperties)
        ) {
          this.jsf.schema.type = 'object';

          // Fix JSON schema shorthand (JSON Form style)
        } else {
          this.jsf.JsonFormCompatibility = true;
          this.jsf.schema = {
            'type': 'object',
            'properties': this.jsf.schema
          };
        }
      }

      // If needed, update JSON Schema to draft 6 format, including
      // draft 3 (JSON Form style) and draft 4 (Angular Schema Form style)
      this.jsf.schema = convertSchemaToDraft6(this.jsf.schema);

      // Initialize ajv and compile schema
      this.jsf.compileAjvSchema();

      // Create schemaRefLibrary, schemaRecursiveRefMap, dataRecursiveRefMap, & arrayMap
      this.jsf.schema = resolveSchemaReferences(
        this.jsf.schema, this.jsf.schemaRefLibrary, this.jsf.schemaRecursiveRefMap,
        this.jsf.dataRecursiveRefMap, this.jsf.arrayMap
      );
      if (hasOwn(this.jsf.schemaRefLibrary, '')) {
        this.jsf.hasRootReference = true;
      }


    }
  }


  private initializeData() {
    if (hasValue(this.data)) {
      this.jsf.formValues = cloneDeep(this.data);
      this.formValuesInput = 'data';
    } else if (hasValue(this.model)) {
      this.jsf.AngularSchemaFormCompatibility = true;
      this.jsf.formValues = cloneDeep(this.model);
      this.formValuesInput = 'model';
    } else if (hasValue(this.ngModel)) {
      this.jsf.AngularSchemaFormCompatibility = true;
      this.jsf.formValues = cloneDeep(this.ngModel);
      this.formValuesInput = 'ngModel';
    } else if (isObject(this.form) && hasValue(this.form.value)) {
      this.jsf.JsonFormCompatibility = true;
      this.jsf.formValues = cloneDeep(this.form.value);
      this.formValuesInput = 'form.value';
    } else if (isObject(this.form) && hasValue(this.form.data)) {
      this.jsf.formValues = cloneDeep(this.form.data);
      this.formValuesInput = 'form.data';
    } else if (hasValue(this.formData)) {
      this.jsf.ReactJsonSchemaFormCompatibility = true;
      this.formValuesInput = 'formData';
    } else if (hasOwn(this.form, 'formData') && hasValue(this.form.formData)) {
      this.jsf.ReactJsonSchemaFormCompatibility = true;
      this.jsf.formValues = cloneDeep(this.form.formData);
      this.formValuesInput = 'form.formData';
    } else {
      this.formValuesInput = null;
    }
  }

  /**
   * 'initializeLayout' function
   *
   * Initialize 'layout'
   * Use first available array input:
   * 1. layout - recommended
   * 2. form - Angular Schema Form style
   * 3. form.form - JSON Form style
   * 4. form.layout - Single input style
   * 5. (none) no layout - set default layout instead
   *    (full layout will be built later from the schema)
   *
   * Also, if alternate layout formats are available,
   * import from 'UISchema' or 'customFormItems'
   * used for React JSON Schema Form and JSON Form API compatibility
   * Use first available input:
   * 1. UISchema - React JSON Schema Form style
   * 2. form.UISchema - For testing single input React JSON Schema Forms
   * 2. form.customFormItems - JSON Form style
   * 3. (none) no input - don't import
   */
  private initializeLayout() {

    // Rename JSON Form-style 'options' lists to
    // Angular Schema Form-style 'titleMap' lists.
    const fixJsonFormOptions = (layout: any): any => {
      if (isObject(layout) || isArray(layout)) {
        forEach(layout, (value, key) => {
          if (hasOwn(value, 'options') && isObject(value.options)) {
            value.titleMap = value.options;
            delete value.options;
          }
        }, 'top-down');
      }
      return layout;
    };

    // Check for layout inputs and, if found, initialize form layout
    if (this.form && isArray(this.form.layout)) {
      this.jsf.layout = cloneDeep(this.form.layout);
    } else {
      this.jsf.layout = ['*'];
    }

    // Check for alternate layout inputs
    let alternateLayout: any = null;
    if (hasOwn(this.form, 'UISchema')) {
      this.jsf.ReactJsonSchemaFormCompatibility = true;
      alternateLayout = cloneDeep(this.form.UISchema);
    } else if (hasOwn(this.form, 'uiSchema')) {
      this.jsf.ReactJsonSchemaFormCompatibility = true;
      alternateLayout = cloneDeep(this.form.uiSchema);
    } else if (hasOwn(this.form, 'customFormItems')) {
      this.jsf.JsonFormCompatibility = true;
      alternateLayout = fixJsonFormOptions(cloneDeep(this.form.customFormItems));
    }

    // if alternate layout found, copy alternate layout options into schema
    if (alternateLayout) {
      JsonPointer.forEachDeep(alternateLayout, (value, pointer) => {
        const schemaPointer = pointer
          .replace(/\//g, '/properties/')
          .replace(/\/properties\/items\/properties\//g, '/items/properties/')
          .replace(/\/properties\/titleMap\/properties\//g, '/titleMap/properties/');
        if (hasValue(value) && hasValue(pointer)) {
          let key = JsonPointer.toKey(pointer);
          const groupPointer = (JsonPointer.parse(schemaPointer) || []).slice(0, -2);
          let itemPointer: string | string[];

          // If 'ui:order' object found, copy into object schema root
          if (key.toLowerCase() === 'ui:order') {
            itemPointer = [...groupPointer, 'ui:order'];

            // Copy other alternate layout options to schema 'x-schema-form',
            // (like Angular Schema Form options) and remove any 'ui:' prefixes
          } else {
            if (key.slice(0, 3).toLowerCase() === 'ui:') { key = key.slice(3); }
            itemPointer = [...groupPointer, 'x-schema-form', key];
          }
          if (JsonPointer.has(this.jsf.schema, groupPointer) &&
            !JsonPointer.has(this.jsf.schema, itemPointer)
          ) {
            JsonPointer.set(this.jsf.schema, itemPointer, value);
          }
        }
      });
    }
  }

  /**
   * 'activateForm' function
   *
   * ...continued from 'initializeSchema' function, above
   * If 'schema' has not been initialized (i.e. no schema input found)
   * 6. If layout input - build schema from layout input
   * 7. If data input - build schema from data input
   *
   * Create final layout,
   * build the FormGroup template and the Angular FormGroup,
   * subscribe to changes,
   * and activate the form.
   */
  private activateForm() {

    // If 'schema' not initialized
    if (isEmpty(this.jsf.schema)) {

      // TODO: If full layout input (with no '*'), build schema from layout
      // if (!this.jsf.layout.includes('*')) {
      //   this.jsf.buildSchemaFromLayout();
      // } else

      // If data input, build schema from data
      if (!isEmpty(this.jsf.formValues)) {
        this.jsf.buildSchemaFromData();
      }
    }

    if (!isEmpty(this.jsf.schema)) {

      // If not already initialized, initialize ajv and compile schema
      this.jsf.compileAjvSchema();

      // Update all layout elements, add values, widgets, and validators,
      // replace any '*' with a layout built from all schema elements,
      // and update the FormGroup template with any new validators
      this.jsf.buildLayout(this.widgetLibrary);

      // Build the Angular FormGroup template from the schema
      this.jsf.buildFormGroupTemplate(this.jsf.formValues);

      // Build the real Angular FormGroup from the FormGroup template
      this.jsf.buildFormGroup();
    }

    if (this.jsf.formGroup) {

      // Reset initial form values
      if (!isEmpty(this.jsf.formValues) &&
        this.jsf.formOptions.setSchemaDefaults !== true &&
        this.jsf.formOptions.setLayoutDefaults !== true
      ) {
        this.setFormValues(this.jsf.formValues);
      }

      // TODO: Figure out how to display calculated values without changing object data
      // See http://ulion.github.io/jsonform/playground/?example=templating-values
      // Calculate references to other fields
      // if (!isEmpty(this.jsf.formGroup.value)) {
      //   forEach(this.jsf.formGroup.value, (value, key, object, rootObject) => {
      //     if (typeof value === 'string') {
      //       object[key] = this.jsf.parseText(value, value, rootObject, key);
      //     }
      //   }, 'top-down');
      // }

      // Subscribe to form changes to output live data, validation, and errors
      this.jsf.dataChanges.subscribe(data => {
        this.onChanges.emit(this.objectWrap ? data['1'] : data);
        if (this.formValuesInput && this.formValuesInput.indexOf('.') === -1) {
          this[`${this.formValuesInput}Change`].emit(this.objectWrap ? data['1'] : data);
        }
      });

      // Trigger change detection on statusChanges to show updated errors
      this.jsf.formGroup.statusChanges.subscribe(() => this.changeDetector.markForCheck());
      this.jsf.isValidChanges.subscribe(isValid => this.isValid.emit(isValid));
      this.jsf.validationErrorChanges.subscribe(err => this.validationErrors.emit(err));

      // Output final schema, final layout, and initial data
      this.formSchema.emit(this.jsf.schema);
      this.formLayout.emit(this.jsf.layout);
      this.onChanges.emit(this.objectWrap ? this.jsf.data['1'] : this.jsf.data);

      // If validateOnRender, output initial validation and any errors
      const validateOnRender =
        JsonPointer.get(this.jsf, '/formOptions/validateOnRender');
      if (validateOnRender) { // validateOnRender === 'auto' || true
        const touchAll = (control) => {
          if (validateOnRender === true || hasValue(control.value)) {
            control.markAsTouched();
          }
          Object.keys(control.controls || {})
            .forEach(key => touchAll(control.controls[key]));
        };
        touchAll(this.jsf.formGroup);
        this.isValid.emit(this.jsf.isValid);
        this.validationErrors.emit(this.jsf.ajvErrors);
      }
    }
  }
}
